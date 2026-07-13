# -*- coding: utf-8 -*-
"""
Created on Fri Apr  3 14:23:24 2026

@author: Satoru Muro
"""

import io
import requests
import numpy as np
from PIL import Image
from PyQt6.QtGui import QPainterPath


class RemoteSAM2Interface:
    def __init__(self, base_url: str = ""):
        self.base_url = base_url.rstrip("/")
        self.has_cuda = False
        self.is_connected = False

    def set_base_url(self, url: str):
        self.base_url = url.rstrip("/")

    import requests
    
    
    
        
    def connect(self) -> bool:
        if not self.base_url:
            self.is_connected = False
            return False
    
        try:
            r = requests.get(f"{self.base_url}/health", timeout=10)
            r.raise_for_status()
    
            try:
                data = r.json()
            except ValueError:
                print("[ERROR] Response is not JSON. You may have entered a Colab notebook URL instead of an API URL.")
                self.is_connected = False
                return False
    
            self.is_connected = bool(data.get("ok", False))
            return self.is_connected
    
        except requests.exceptions.ConnectionError:
            print("[ERROR] Cannot reach server. Check URL or network connection.")
        except requests.exceptions.Timeout:
            print("[ERROR] Connection timed out.")
        except requests.exceptions.HTTPError as e:
            print(f"[ERROR] HTTP error: {e}")
        except Exception as e:
            print(f"[ERROR] Unexpected error: {e}")
    
        self.is_connected = False
        return False






    def mask_to_qpath(self, mask):
        from skimage import measure

        path = QPainterPath()
        contours = measure.find_contours(mask.astype(np.uint8), 0.5)

        for contour in contours:
            if len(contour) < 2:
                continue
            path.moveTo(contour[0][1], contour[0][0])  # (y, x) -> (x, y)
            for y, x in contour[1:]:
                path.lineTo(x, y)

        return path

    def run_segmentation(self, image_np, box_prompt, progress_callback=None):
        if not self.is_connected:
            raise RuntimeError("Remote SAM2 is not connected.")

        if progress_callback:
            progress_callback(5)

        image_pil = Image.fromarray(image_np)
        buf = io.BytesIO()
        image_pil.save(buf, format="PNG")
        buf.seek(0)

        payload = {
            "x1": float(box_prompt[0][0]),
            "y1": float(box_prompt[0][1]),
            "x2": float(box_prompt[1][0]),
            "y2": float(box_prompt[1][1]),
        }

        if progress_callback:
            progress_callback(30)

        r = requests.post(
            f"{self.base_url}/segment_box",
            files={"image": ("image.png", buf, "image/png")},
            data=payload,
            timeout=120
        )
        r.raise_for_status()

        if progress_callback:
            progress_callback(80)

        result = Image.open(io.BytesIO(r.content)).convert("L")
        mask = (np.array(result) > 0).astype(np.uint8)

        if progress_callback:
            progress_callback(100)

        return mask