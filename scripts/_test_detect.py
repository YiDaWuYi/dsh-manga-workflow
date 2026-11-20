# -*- coding: utf-8 -*-
import os
os.environ['EASYOCR_MODULE_PATH'] = r'E:\dph hanhhua gonzuoqu\_easyocr'
import numpy as np
from PIL import Image
import easyocr

B = r'E:\dph hanhhua gonzuoqu\4252703-(Kemoket 13) [Lomelette (Lassie)] Tsuyu to kage no shichihenge'
page = os.path.join(B, '00000005.webp')
img = np.array(Image.open(page).convert('RGB'))
print('图片:', img.shape)

reader = easyocr.Reader(['ja'], gpu=True, verbose=False)
horiz, free = reader.detect(img, min_size=10)
print('检测到水平框:', sum(len(x) for x in horiz), ' 自由框:', sum(len(x) for x in free))
# 打印几个
cnt = 0
for group in horiz:
    for b in group:
        if cnt < 20:
            print('  水平:', b)
            cnt += 1
cnt = 0
for group in free:
    for b in group:
        if cnt < 10:
            print('  自由:', b)
            cnt += 1
