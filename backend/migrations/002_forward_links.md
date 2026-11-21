# 002 转发关系补录与运行版本锁定

同一封来信多次转发后拆进训练批和留出批会让验收分数虚高。本次变更新增转发关系表，并给运行记录增加提交时锁定的关系版本。

- `forward_links` 新表，由 `create_all` 补建。按 `dataset_id` 归属批次，`(dataset_id, left_id, right_id)` 唯一去重；`version` 记录该关系补录进库的批次版本，只增不改。
- `runs.relation_version` 新列，启动时执行 `ALTER TABLE runs ADD COLUMN IF NOT EXISTS relation_version INTEGER`（PostgreSQL 16，幂等）。提交运行时写入当时的转发关系版本，后台重试沿用该版本重放 `version <= relation_version` 的关系；历史运行为 NULL，按版本 0（无关系）处理。
- 计算时把 `version <= 锁定版本` 的关系按编号并查集串连，横跨 train/test 的整串剔除后再重训计分，剔除链路写入结果表与导出 CSV。
