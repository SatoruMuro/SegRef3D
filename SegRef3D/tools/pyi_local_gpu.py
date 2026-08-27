import os


os.environ["SEGREF3D_DISABLE_SAM2"] = "0"
os.environ["SEGREF3D_EDITION"] = "local-gpu"
os.environ["SEGREF3D_FORCE_SAFE_SDPA"] = "1"
