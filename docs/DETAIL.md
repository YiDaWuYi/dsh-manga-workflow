# 漫画汉化工作流

把本地标框、OCR、去字、嵌字这套流程接进 DSH,让 Agent 直接调用。

## 提供的工具

| 工具 | 作用 |
|---|---|
| `manga_ocr` | 对已标框的漫画文件夹跑本地 OCR(日文 Manga OCR / 韩文 EasyOCR),生成 `ocr_text.json` |
| `manga_embed` | 按 `trans.json` 擦原文 + 写中文;可选 GPU LaMa 去字或预览模式 |
| `manga_status` | 汇总文件夹:有标框页数、总框数、已翻译数、整页未翻译的页 |

## 前提

- 漫画文件夹里已有 `regions.json`(用工作区的 `mark.bat` 标框得到);
- 本地 OCR / GPU 去字需要 `_venv`(torch、manga-ocr、easyocr、iopaint)已存在于工作区。

## 配置

在 `cordis.patch.yml` 的 `config` 中可改:

| 键 | 说明 | 默认 |
|---|---|---|
| `scriptsDir` | 工作流 Python 脚本目录 | `E:/manga_tool` |
| `pythonPath` | 运行脚本的 Python | `E:/_venv/Scripts/python.exe` |

## 限制

- 长段落和花体拟声词的本地 OCR 可能读错或瞎编,需要人工或用 AI 补读;
- GPU LaMa 对密集网点背景会有轻微柔化。
