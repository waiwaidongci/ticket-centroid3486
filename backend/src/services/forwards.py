"""转发关系补录：单独导入、按版本累积，不改动原批次。"""
import csv
import io
from sqlalchemy import func, select
from src.domain.analysis import _identifier
from src.domain.spec import SPEC
from src.models.source import ForwardLink


def current_version(db, dataset_id):
    return db.scalar(select(func.max(ForwardLink.version)).where(ForwardLink.dataset_id == dataset_id)) or 0


def links_upto(db, dataset_id, version):
    """取出指定版本（含）之前补录的转发关系，重试时按锁定版本重放。"""
    if not version:
        return []
    rows = db.scalars(
        select(ForwardLink).where(ForwardLink.dataset_id == dataset_id, ForwardLink.version <= version)
        .order_by(ForwardLink.id))
    return [[item.left_id, item.right_id] for item in rows]


def parse_links(text, rows):
    """校验补录 CSV，返回（规范化的关系对, 文件内重复条数）。两端编号须在当前批次中。"""
    reader = csv.DictReader(io.StringIO(text.removeprefix('\ufeff'), newline=''), strict=True)
    fields = SPEC['forward_fields']
    keys = {field['key'] for field in fields}
    try:
        headers = reader.fieldnames or []
        if set(headers) != keys or len(headers) != len(set(headers)):
            raise ValueError('CSV 表头与转发关系字段不符，请下载补录模板检查列名')
        known = {}
        for row in rows:
            known.setdefault(_identifier(row['ticket_id']), row['ticket_id'])
        pairs = []
        seen = set()
        skipped = 0
        for raw in reader:
            if len(pairs) + skipped >= 5000:
                raise ValueError('一次补录最多 5000 对转发关系')
            try:
                if None in raw or any(value is None for value in raw.values()):
                    raise ValueError('工作表的列数与表头不一致')
                ends = []
                for field in fields:
                    value = raw.get(field['key'])
                    value = value.strip() if isinstance(value, str) else ''
                    if not value or len(value) > field['max_length']:
                        raise ValueError(f'「{field["label"]}」缺失或长度超限')
                    ticket = known.get(_identifier(value))
                    if not ticket:
                        raise ValueError(f'编号「{value}」不在当前批次中')
                    ends.append(ticket)
                if ends[0] == ends[1]:
                    raise ValueError('两端编号相同，无法构成转发关系')
                pair = tuple(sorted(ends))
                if pair in seen:
                    skipped += 1
                else:
                    seen.add(pair)
                    pairs.append(pair)
            except ValueError as error:
                raise ValueError(f'CSV 第 {reader.line_num} 行 · {error}') from None
    except csv.Error:
        raise ValueError(f'CSV 第 {reader.line_num} 行附近格式不正确') from None
    if not pairs and not skipped:
        raise ValueError('CSV 至少需要一行有效数据')
    return pairs, skipped


def plan_links(pairs, existing, version):
    """在已有关系上规划本次补录：只收新关系，有新增才推进版本。"""
    fresh = [pair for pair in pairs if pair not in existing]
    skipped = len(pairs) - len(fresh)
    return (version + 1 if fresh else version), fresh, skipped


def save_links(db, dataset, pairs, actor, skipped=0):
    """把新关系写入下一个版本，返回（当前版本, 新增条数, 重复条数）。调用方需先锁定批次行。"""
    version = current_version(db, dataset.id)
    existing = {(item.left_id, item.right_id)
                for item in db.scalars(select(ForwardLink).where(ForwardLink.dataset_id == dataset.id))}
    version, fresh, duplicates = plan_links(pairs, existing, version)
    for left, right in fresh:
        db.add(ForwardLink(dataset_id=dataset.id, left_id=left, right_id=right,
                           version=version, author=actor))
    return version, len(fresh), skipped + duplicates


def template():
    buffer = io.StringIO(newline='')
    writer = csv.DictWriter(buffer, fieldnames=[field['key'] for field in SPEC['forward_fields']])
    writer.writeheader()
    writer.writerows([
        {'ticket_id': 'QQ-TRAIN-04', 'related_id': 'QQ-TEST-02'},
        {'ticket_id': 'QQ-TEST-02', 'related_id': 'QQ-TRAIN-05'},
    ])
    return '\ufeff' + buffer.getvalue()
