from PIL import Image, ImageDraw, ImageFont
from pathlib import Path
root=Path(r"C:\Users\admin\.codex\visualizations\2026\11\20\01a1f71a-aff5-7ae1-9ba7-ff9d45e70925\whyb-src\src\assets")
for size in (16,32,48,128):
    scale=8; w=size*scale
    im=Image.new('RGBA',(w,w),(0,0,0,0)); d=ImageDraw.Draw(im)
    for y in range(w):
        t=y/max(1,w-1)
        c=(int(37+(124-37)*t),int(99+(58-99)*t),int(235+(237-235)*t),255)
        d.line((0,y,w,y),fill=c)
    mask=Image.new('L',(w,w),0); md=ImageDraw.Draw(mask); md.rounded_rectangle((0,0,w-1,w-1),radius=int(w*.24),fill=255)
    im.putalpha(mask)
    try: font=ImageFont.truetype('C:/Windows/Fonts/arialbd.ttf', int(w*.55))
    except: font=ImageFont.load_default()
    label='L'; box=d.textbbox((0,0),label,font=font); tw=box[2]-box[0]; th=box[3]-box[1]
    d.text(((w-tw)/2,(w-th)/2-box[1]-w*.02),label,font=font,fill=(255,255,255,255))
    im.resize((size,size),Image.Resampling.LANCZOS).save(root/f'icon-{size}.png')
print('icons written')
