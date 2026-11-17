# dsh-manga-workflow

DeepSeek Harness 的漫画汉化工作流插件:本地 OCR(日/韩)、GPU 去字(LaMa)、中文嵌字。

## 提供的工具

| 工具 | 作用 |
|---|---|
| `manga_ocr` | 对已标框的漫画文件夹跑本地 OCR,生成 `ocr_text.json` |
| `manga_embed` | 按 `trans.json` 擦原文 + 写中文,可选 GPU LaMa 去字或预览 |
| `manga_status` | 汇总页数、框数、翻译进度 |

## 安装

### 方式一:从 GitHub Release tarball(推荐)

```sh
dsh plugin --profile <你的profile> add https://github.com/YiDaWuYi/dsh-manga-workflow/releases/download/v1.0.0/dsh-manga-workflow-1.0.0.tgz
```

或在 DSH 的 **插件 → 添加插件** 里填这个 tarball 地址。

### 方式二:从本地目录

```sh
dsh plugin --profile <你的profile> add <本仓库目录>
```

## 配置

在 profile 的 `cordis.patch.yml` 里可改:

```yaml
- id: manga-workflow
  name: dsh-manga-workflow
  config:
    scriptsDir: 'E:/manga_tool'
    pythonPath: 'E:/_venv/Scripts/python.exe'
```

| 键 | 说明 | 默认 |
|---|---|---|
| `scriptsDir` | 工作流 Python 脚本目录 | `E:/manga_tool` |
| `pythonPath` | 运行脚本的 Python | `E:/_venv/Scripts/python.exe` |

## 依赖

- 工作区里的 `manga_tool` 脚本(mark_tool.py / ocr_regions.py / embed_regions.py);
- `_venv`(torch CUDA、manga-ocr、easyocr、iopaint),用于本地 OCR 与 GPU 去字。

## 限制

- 长段落和花体拟声词的本地 OCR 可能读错或瞎编,需要人工或 AI 补读;
- GPU LaMa 对密集网点背景会有轻微柔化。

## License

MIT
