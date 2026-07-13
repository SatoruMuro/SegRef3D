# totalseg_interface.py
import os, shutil, subprocess, sys

class TotalSegInterface:
    def __init__(self, exe_name=None):
        candidates = []
        scripts_dir = os.path.dirname(sys.executable)  # 例: ...\Python312
        scripts_dir = os.path.join(scripts_dir, "Scripts")
        candidates += [
            exe_name,
            os.path.join(scripts_dir, "TotalSegmentator.exe"),
            os.path.join(scripts_dir, "totalsegmentator.exe"),
            shutil.which("TotalSegmentator"),
            shutil.which("totalsegmentator"),
        ]
        self.exe = next((c for c in candidates if c and os.path.exists(c)), "TotalSegmentator")

    def is_available(self) -> bool:
        return os.path.exists(self.exe) or shutil.which(self.exe) is not None

    def run(self, input_path, output_dir, task="total", use_cpu=False,
            extra_args=None, env=None, roi_subset=None):
        os.makedirs(output_dir, exist_ok=True)
        cmd = [self.exe, "-i", input_path, "-o", output_dir]
        if task and task != "total":
            cmd += ["--task", task]
        # ★ あなたのCLIは --device/-d 方式
        cmd += ["-d", "cpu" if use_cpu else "gpu"]
        if roi_subset:
            cmd += ["--roi_subset"] + roi_subset
        if extra_args:
            cmd += extra_args
        print("[TotalSeg] Running:", " ".join(cmd))
        proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, env=env)
        if proc.returncode != 0:
            raise RuntimeError(f"TotalSegmentator failed:\n{proc.stdout}")
        return proc.stdout
