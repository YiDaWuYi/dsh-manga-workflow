> **代码审计修复版**:修掉一个会导致「点清理缓存就把所有项目的框/译文删光」的严重隐患,并让所有脚本严格遵守「源目录只读」。

## [1.15.19] — 2026-11-21

**主题:代码审计修复(数据安全)**

### 修复

- **严重:清理缓存会删掉项目库**。「设置 → 缓存/模型 → 清理缓存」里的「工作区预览缓存」原指向 `<工作区>\projects`(项目数据根目录),点一下会把所有书的框/译文/原文全部删除。现在该缓存项改指 `<工作区>\_preview_cache`,并新增保护:项目库 `projects`、成品 `已完成`、源书 `工作区文件` 三个目录(及其子目录)**拒绝被缓存清理删除**。
- **脚本不再往只读源目录写文件**:以下输出全部改写到 `MANGA_DATA_DIR`(项目数据目录):
  - `preflight.py` 的三个 `.bak_preflight` 备份与 `preflight_report.json`;
  - `proofread.py` 的 `proofread_report.json` 与嵌字后校对读取的输出目录;
  - `translate.py` 的 `trans_alt.json`;
  - `ocr_fallback.py` 的 `ocr_fallback_done.json`;
  - `embed_regions.py` 的默认输出目录与 `_proofread_post.txt`;
  - 桌面端 `mark_tool.py` 的 `_sync_base.json`。
- **GPU 去字缺依赖时友好报错**:`embed_lama.py` 找不到 io-paint 时不再抛 Python traceback,改为提示「先装 GPU 去字依赖,或改用普通抹除」并返回码 2。
- `translate.py` 删除一行重复赋值。

### 验证

- 2 页测试书(源目录只放图片,数据放临时数据目录):`preflight` / `proofread --stage pre` / `embed_regions`(普通抹除)全部正常,**源目录运行前后文件列表完全一致**;所有报告/备份/输出都落在数据目录。
- `node --check` 四个 JS 文件、`py_compile` 全部脚本通过;桌面端启动与 UI 测量脚本通过。

---

### 安装/更新

```
插件管理 → 移除 dsh-manga-workflow → 安装 dsh-manga-workflow-1.15.19.tgz
```
