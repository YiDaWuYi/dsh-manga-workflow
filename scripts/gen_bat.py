# -*- coding: utf-8 -*-
"""生成 GBK 编码的 mark.bat / embed.bat(中文 Windows 命令行正确显示)。"""

mark = '''@echo off
set "PY=C:\\Users\\hyh15\\.dsh\\dsh-runtimes\\dsh-primary-runtime\\dependencies\\python\\python.exe"
set "TOOL=%~dp0"
set "DIR=%~1"
if "%DIR%"=="" set /p "DIR=把图片文件夹拖到本文件上,或输入其路径: "
"%PY%" "%TOOL%mark_tool.py" "%DIR%"
echo.
echo 标框结束。若已保存,请把该文件夹路径发给 AI 翻译。
pause
'''

embed = '''@echo off
set "PY=C:\\Users\\hyh15\\.dsh\\dsh-runtimes\\dsh-primary-runtime\\dependencies\\python\\python.exe"
set "TOOL=%~dp0"
set "DIR=%~1"
if "%DIR%"=="" set /p "DIR=把图片文件夹拖到本文件上,或输入其路径: "
"%PY%" "%TOOL%embed_regions.py" "%DIR%"
echo.
echo 完成。成品在 %DIR%\\out 里。
pause
'''

open('mark.bat', 'w', encoding='gbk').write(mark)
open('embed.bat', 'w', encoding='gbk').write(embed)
print('rewritten mark.bat / embed.bat in GBK')
