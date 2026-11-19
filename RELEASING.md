# 发版规范(版本号 · 更新日志 · 发布流程)

本文件是**强制流程**。每次改动只要面向用户,就必须走完这里的步骤。

## 一、版本号命名规则

采用**语义化版本**(SemVer):`MAJOR.MINOR.PATCH`,界面显示为 `V<MAJOR>.<MINOR>[.<PATCH>]`。

| 位 | 何时 +1 | 例子 |
| --- | --- | --- |
| **MAJOR** | 不兼容的大改版(数据格式变更、旧配置失效) | `1.x.x → 2.0.0` |
| **MINOR** | 新增功能、行为增强、界面变化(向下兼容) | `1.5.0 → 1.6.0` |
| **PATCH** | 仅修 bug / 文案 / 样式,无新功能 | `1.5.0 → 1.5.1` |

细则:

- 主版本号的**第一位数字**目前固定为 `1`;**第二位数字**表示功能批次(1.5、1.6…);
- 一次发布**只允许**提升一位,不允许跳位(除了 MAJOR);
- 发布前版本号必须**三处一致**(见下方检查清单);
- 界面展示去掉补零:内部 `1.5.0` → 界面显示 `V1.5`;
  当 PATCH > 0 时显示完整形式,例如 `1.5.1` → `V1.5.1`;
- 预发布可选后缀 `-beta.1` / `-rc.1`,**不得**用于正式发布。

## 二、更新日志规则

`CHANGELOG.md` 采用 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 风格:

1. **每次发版必须新增一节**,放在最上面(最新在上,旧的保留);
2. 标题格式:`## [x.y.z] — YYYY-MM-DD`(日期用本地时区当天);
3. 小节固定顺序:`### 新增` → `### 改进` → `### 修复` → `### 配置与文件变化`
   → `### 升级说明` → `### 测试` → `### 已知限制`,**没有内容的小节可省略**;
4. 每条写**用户能感知的行为**,不要写"重构了某某函数";
5. 修复项尽量写清「现象 + 原因 + 现在的行为」;
6. 测试项写**实际执行过的项数**,不写"已测试";
7. 不要留空节、不要写 `TODO`。

## 三、版本号必须同步的位置(4 处)

| 位置 | 字段 | 示例 |
| --- | --- | --- |
| `dsh-manga-plugin/package.json` | `version` | `"1.5.0"` |
| `dsh-manga-plugin/client.js` | 工厂顶部 `const APP_VERSION` | `'V1.5'` |
| `manga_tool/mark_tool.py` | `APP_VERSION` | `'V1.5'` |
| `dsh-manga-plugin/README.md` | Release 下载链接里的版本 | `v1.5.0/...-1.5.0.tgz` |

> 另外:发布用的 tarball 文件名必须带版本号 —— `dsh-manga-workflow-<x.y.z>.tgz`。

## 四、发版检查清单

```bash
# 1. 同步版本号 + 生成 CHANGELOG 骨架(一条命令搞定)
python dsh-manga-plugin/tools/bump_version.py 1.6.0 --note "一句话主题"

# 2. 补完 CHANGELOG.md 的内容(新增/改进/修复/测试/限制)

# 3. 一致性检查(会校验 4 处版本是否对齐、CHANGELOG 是否有该版本节)
python dsh-manga-plugin/tools/bump_version.py --check

# 4. 语法检查
node --check dsh-manga-plugin/client.js
node --check dsh-manga-plugin/src/host.js
python -m py_compile manga_tool/mark_tool.py

# 5. 打包(文件名自动带版本号)
python dsh-manga-plugin/tools/bump_version.py --pack

# 6. 插件管理里「移除 → 安装」新 tarball,并验证版本号
#    桌面版无需重装(直接跑 manga_tool/)

# 7. 实机验证受影响的功能(按 CHANGELOG 的「测试」小节逐条)

# 8. 发 Release:tag = v<x.y.z>,上传 dsh-manga-workflow-<x.y.z>.tgz,
#    Release 说明直接复制 CHANGELOG 对应小节
```

## 五、约定

- **不修改已发布版本**的版本号或日志(历史只追加);
- 桌面端脚本改动**不需要**重装插件,但版本号仍要一起提升并写进日志;
- 只改文档/注释且不影响用户的改动,可以只提 PATCH;
- 若忘记提版本号,`--check` 会报错,发版前必须清零。
