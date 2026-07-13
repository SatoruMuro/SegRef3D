# sam2_interface.py

import os
import sys
import numpy as np
from PIL import Image
from PyQt6.QtGui import QPainterPath
from PyQt6.QtWidgets import QApplication


# # sam2pkg/sam2 をパスに追加
# BASE_DIR = os.path.dirname(os.path.abspath(__file__))
# SAM2_DIR = os.path.join(BASE_DIR, "sam2pkg", "sam2")
# if SAM2_DIR not in sys.path:
#     sys.path.insert(0, SAM2_DIR)

# from build_sam import build_sam2_video_predictor  # ✅ sam2pkg/sam2 内にある前提


# sam2pkg/sam2 を直接追加する
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SAM2_DIR = os.path.join(BASE_DIR, "sam2pkg", "sam2")




class SAM2Interface:
    def __init__(self,
                 model_ckpt_path=os.path.join(BASE_DIR, "checkpoints", "sam2.1_hiera_large.pt"),
                 model_cfg_path=os.path.join(BASE_DIR, "configs", "sam2.1", "sam2.1_hiera_l.yaml"),
                 cuda_info=None,
                 allow_cpu_fallback=False):

        # self.device = self._select_device()
        # self.predictor = build_sam2_video_predictor(model_cfg_path, model_ckpt_path, device=self.device)
        # print("[INFO] SAM2 model initialized.")

        if not os.path.isdir(SAM2_DIR):
            raise RuntimeError(f"SAM2 package directory is missing: {SAM2_DIR}")
        if not os.path.exists(model_ckpt_path):
            raise RuntimeError(f"SAM2 checkpoint is missing: {model_ckpt_path}")
        if not os.path.exists(model_cfg_path):
            raise RuntimeError(f"SAM2 config is missing: {model_cfg_path}")

        try:
            import torch
        except Exception as exc:
            raise RuntimeError(
                "PyTorch is required for local SAM2 but is not installed or bundled."
            ) from exc

        try:
            from gpu_runtime import (
                choose_sam2_mode,
                configure_safe_torch_attention,
                get_cuda_diagnostics,
                print_cuda_diagnostics,
            )
        except Exception as exc:
            raise RuntimeError("GPU runtime diagnostics are unavailable.") from exc

        if SAM2_DIR not in sys.path:
            sys.path.insert(0, SAM2_DIR)

        try:
            from build_sam import build_sam2_video_predictor
        except Exception as exc:
            raise RuntimeError(
                "SAM2 could not be imported. Ensure sam2pkg is included in the GPU build."
            ) from exc

        self._torch = torch
        configure_safe_torch_attention()
        self.cuda_info = cuda_info or get_cuda_diagnostics()
        self.mode, self.status_message = choose_sam2_mode(
            self.cuda_info,
            allow_cpu_fallback=allow_cpu_fallback,
        )
        self.has_cuda = self.mode == "cuda"
        self.enabled = self.mode in ("cuda", "cpu")
        self.disabled_reason = None if self.enabled else self.status_message
        self.device = self._select_device()
        self.predictor = None

        if self.enabled:
            self.predictor = build_sam2_video_predictor(model_cfg_path, model_ckpt_path, device=self.device)
            print(f"[INFO] SAM2 model initialized on {self.device}.")
        else:
            print(f"[INFO] {self.status_message}")

        print_cuda_diagnostics(self.cuda_info, sam2_mode=self.mode)


    def _select_device(self):
        # ↓ 以下の行を一時的に追加（GPUがあっても無視）
        # return torch.device("cpu")  # ← 強制的にCPU環境にする        
        
        if self.mode == "cuda":
            device = self._torch.device("cuda")
        elif self.mode == "cpu":
            device = self._torch.device("cpu")
        else:
            device = self._torch.device("cpu")
        print(f"[INFO] Using device: {device}")
        return device


    def ensure_available(self):
        if self.predictor is None:
            raise RuntimeError(self.disabled_reason or "SAM2 is not available in this runtime.")
    

    

    def predict_from_box(self, image_np: np.ndarray, box_xyxy: list) -> np.ndarray:
        """
        画像とボックス（[x1, y1, x2, y2]）を入力として、2Dマスクを返す
        """
        self.ensure_available()
        assert image_np.ndim == 3 and image_np.shape[2] in (3, 4), "Input must be RGB or RGBA image"
        if image_np.shape[2] == 4:
            image_np = image_np[:, :, :3]  # RGBA → RGB

        image_pil = Image.fromarray(image_np)
        self.predictor.set_image(image_pil)

        # box_xyxy は [x1, y1, x2, y2]
        self.predictor.add_box_prompt([box_xyxy])
        outputs = self.predictor()  # return masklets dict

        masks = outputs["masks"]  # list of NumPy配列（0 or 1）
        if len(masks) == 0:
            print("[WARNING] No mask found.")
            return np.zeros(image_np.shape[:2], dtype=np.uint8)
        return masks[-1].astype(np.uint8)  # 最新の1つを返す（例）
    
    
    def mask_to_qpath(self, mask):
        from skimage import measure
        path = QPainterPath()
        contours = measure.find_contours(mask.astype(np.uint8), 0.5)
    
        for contour in contours:
            if len(contour) < 2:
                continue
            path.moveTo(contour[0][1], contour[0][0])  # (y, x)
            for y, x in contour[1:]:
                path.lineTo(x, y)
    
        return path
    
    

    
    def run_segmentation(self, image_np, box_prompt, progress_callback=None):
        import tempfile
        from PIL import Image
        import numpy as np
    
        if progress_callback:
            progress_callback(0)
    
        self.ensure_available()
        print(f"[INFO] Running SAM2 on box: {box_prompt}")  
    
    
    
    # 一時ディレクトリに画像を保存
        temp_dir = tempfile.mkdtemp()
        temp_image_path = os.path.join(temp_dir, "0.jpg")
        Image.fromarray(image_np).save(temp_image_path)
        
        if progress_callback:
            progress_callback(25)    
            
        # 推論の初期化
        inference_state = self.predictor.init_state(video_path=temp_dir)
            
        if progress_callback:
            progress_callback(50)
    
        # ボックスプロンプトを numpy 配列に変換
        box = np.array([
            box_prompt[0][0], box_prompt[0][1],
            box_prompt[1][0], box_prompt[1][1]
        ], dtype=np.float32)
    
        # ボックスを使って推論を実行
        frame_idx = 0
        _, _, out_mask_logits = self.predictor.add_new_points_or_box(
            inference_state=inference_state,
            frame_idx=frame_idx,
            obj_id=1,
            box=box
        )
    
        if progress_callback:
            progress_callback(75)

        # ロジットからバイナリマスクを生成
        mask = (out_mask_logits[0] > 0.0).cpu().numpy().squeeze()
            
        if progress_callback:
            progress_callback(100)
        
        return mask

    
    
        
    def run_propagation_on_images(self, image_keys, box_prompt):
        print(f"[INFO] Propagation from {image_keys[0]} to {image_keys[-1]}")
        total = len(image_keys)
    
        for idx, key in enumerate(image_keys):
            image_np = self.image_data[key]
            h, w = image_np.shape[:2]
    
            # 座標の変換（% → pixel）
            top_left, bottom_right = box_prompt
            box = np.array([
                int(top_left[0] / 100 * w), int(top_left[1] / 100 * h),
                int(bottom_right[0] / 100 * w), int(bottom_right[1] / 100 * h)
            ], dtype=np.float32)
    
            # マスク生成
            mask = self.run_segmentation(image_np, ((box[0], box[1]), (box[2], box[3])))
    
            # 🔍 マスクの妥当性をチェック
            if (
                mask is None or
                not isinstance(mask, np.ndarray) or
                mask.ndim != 2 or
                mask.shape[0] < 2 or
                mask.shape[1] < 2
            ):
                print(f"[WARN] Skipping frame '{key}' due to invalid mask with shape {getattr(mask, 'shape', None)}")
                continue
    
            # QPainterPath へ変換し、UI に保存
            qpath = self.mask_to_qpath(mask)
            self.ui_ref.save_drawn_path_for_image(key, qpath)

            # 🌟 進捗バー風のテキスト表示
            percent = int((idx + 1) / total * 100)
            bar = "[" + "█" * (percent // 10) + "-" * (10 - percent // 10) + "]"
            self.ui_ref.label_status.setText(f"Propagation {bar} {percent}%")
            QApplication.processEvents()
