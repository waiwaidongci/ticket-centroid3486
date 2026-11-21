import {feedback, field} from '../components/common/fields.js';
import {empty, panel} from '../components/common/panels.js';
import {table} from '../components/common/table.js';
import {handler} from '../hooks/action.js';
import {session} from '../stores/session.js';
import {workspace} from '../stores/workspace.js';
import {button, el, link, p} from '../utils/dom.js';
import {date} from '../utils/format.js';

function forwardsPanel(selected, refresh) {
  const error = feedback();
  const upload = button('校验并补录', {type:'submit', class:'primary'});
  const sample = button('下载补录模板', {class:'quiet',
    onClick:event=>handler(sample,error,()=>workspace.download('/forwards/template',workspace.spec.forward_sample_name))(event)});
  const form = session.canWrite && el('form',{class:'fields',onSubmit:handler(upload,error,async event=>{
    const file = new FormData(event.target).get('forward_csv');
    if (!file?.size) throw new Error('请选择一个转发关系 CSV 文件');
    if (file.size > 1_000_000) throw new Error('补录 CSV 最多 1 MB');
    await workspace.uploadForwards(selected.id, {csv_text:await file.text()});
    await refresh();
  })}, el('label',{class:'field',for:'forward_csv'}, el('span',{},'转发关系 CSV'),
    el('input',{id:'forward_csv',type:'file',name:'forward_csv',accept:'.csv,text/csv',required:true})), upload);
  return workspace.getForwards(selected.id).then(data => {
    const chains = data.chains.length ? panel('按当前关系将剔除的跨批转发串', table([
      {label:'剔除链路', render:row=>`串${row.chain}`},
      {key:'ticket_id', label:'来信编号'},
      {key:'split', label:'原批次'},
      {key:'label', label:'人工归口'},
    ], data.chains.flatMap(chain => chain.tickets.map(ticket => ({chain:chain.chain, ...ticket}))),
      {caption:'跨批转发串预览'})) : null;
    return el('div',{},
      panel('转发关系补录',
        p(`当前版本 v${data.version} · ${data.links.length} 对关系 · 跨批转发串 ${data.chains.length} 个。`,'subtle'),
        p('补录只追加转发关系，不改动原批次；提交运行时锁定当时版本，之后补录的关系需重新运行才生效。','subtle'),
        el('div',{class:'actions'}, sample),
        form, error),
      chains,
      data.links.length ? panel('已补录的转发关系', table([
        {key:'left_id', label:'来信编号'},
        {key:'right_id', label:'转发关联编号'},
        {label:'版本', render:row=>`v${row.version}`},
        {key:'author', label:'补录人'},
        {label:'时间', render:row=>date(row.created_at)},
      ], data.links, {caption:'已补录的转发关系'})) : null);
  });
}

export async function inputs(route, refresh) {
  const {spec,datasets} = workspace;
  const selected = datasets.find(item => item.id === route.id) || datasets[0];
  const error = feedback();
  const sample = button('下载示例 CSV', {class:'quiet',onClick:event=>handler(sample,error,()=>workspace.download('/template',spec.sample_name))(event)});
  const detail = selected && await workspace.getDataset(selected.id,route.offset);
  const columns = spec.fields.map(field => ({key:field.key,label:field.label}));
  const preview = detail ? panel('批次明细', el('div',{class:'actions'},
    el('label',{for:'dataset-id',class:'sr'}, '选择数据批次'),
    el('select',{id:'dataset-id','aria-label':'选择数据批次',onChange:event=>{location.hash=`#inputs/${event.target.value}`;}},
      datasets.map(item=>el('option',{value:item.id,selected:item.id === selected.id}, item.name))),
    link('使用此批次运行',`#run/${detail.id}`,{class:'quiet'})),
    p(`${detail.filename} · ${detail.row_count} 行 · ${date(detail.created_at)}`,'filename'),
    table(columns,detail.rows,{caption:'批次明细',pageSize:16}),
    el('div',{class:'pagination'},
      route.offset > 0 && link('上一批明细',`#inputs/${detail.id}/${Math.max(0,route.offset-16)}`,{class:'quiet'}),
      p(`${detail.rows.length ? route.offset+1 : route.offset}–${route.offset+detail.rows.length} / ${detail.row_count}`),
      route.offset+16 < detail.row_count && link('下一批明细',`#inputs/${detail.id}/${route.offset+16}`,{class:'quiet'})))
    : empty('没有可用的批次。请导入示例或业务 CSV。');
  const submit = button('校验并导入', {type:'submit',class:'primary'});
  const upload = session.canWrite && el('form',{class:'fields',onSubmit:handler(submit,error,async event=>{
    const data = new FormData(event.target);
    const file = data.get('source');
    if (!file?.size) throw new Error('请选择一个 CSV 文件');
    if (file.size > 2_000_000) throw new Error('CSV 最多 2 MB');
    const item = await workspace.upload({name:data.get('batch_name'),filename:file.name,csv_text:await file.text()});
    const target = `#inputs/${item.id}`;
    if (location.hash === target) await refresh();
    else location.hash = target;
  })},field({key:'batch_name',label:'批次名称',type:'string',max_length:120}),
    el('label',{class:'field',for:'source'}, el('span',{},'业务 CSV'),el('input',{id:'source',type:'file',name:'source',accept:'.csv,text/csv',required:true})), submit);
  const forwards = selected ? await forwardsPanel(selected, refresh) : null;
  return el('div',{class:'two-col'},el('div',{class:'wide-panel'},preview,forwards),el('aside',{class:'sidebar-panel'},
    panel('数据导入',p('导入后保留原批次和校验指纹，可用同一份数据复跑。','subtle'),sample,upload,error),
    panel('字段说明',el('dl',{class:'dictionary'},spec.fields.map(item=>el('div',{},el('dt',{},item.label),
      el('dd',{},item.key,item.required === false ? ' · 可空' : ' · 必填',item.options ? ` · ${item.options.join(' / ')}` : ''))))),
    panel('转发关系字段',el('dl',{class:'dictionary'},spec.forward_fields.map(item=>el('div',{},el('dt',{},item.label),
      el('dd',{},item.key,' · 必填 · 须为当前批次中的来信编号')))))));
}
