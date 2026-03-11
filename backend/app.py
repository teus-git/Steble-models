"""
SD-ChatBot Backend - Flask API for Stable Diffusion image generation
Connects the custom stable_diffussion model components with the web interface.
"""

import os
import io
import uuid
import json
import base64
import logging
from datetime import datetime
from flask import Flask, request, jsonify, send_from_directory, Response
from flask_cors import CORS

# ── Configure logging ──────────────────────────────────────────────────────────
logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(levelname)s  %(message)s")
log = logging.getLogger(__name__)

app = Flask(__name__, static_folder="../frontend", static_url_path="")
CORS(app)

# ── Lazy model loading  ────────────────────────────────────────────────────────
_pipeline = None

def get_pipeline():
    """Load SD pipeline once, reuse thereafter."""
    global _pipeline
    if _pipeline is not None:
        return _pipeline

    log.info("Loading Stable Diffusion pipeline …")
    try:
        import torch
        from diffusers import StableDiffusionPipeline, DPMSolverMultistepScheduler
        from diffusers.models import AutoencoderKL, UNet2DConditionModel

        # Default public checkpoint – user can override via SD_MODEL_ID env var
        model_id = os.getenv("SD_MODEL_ID", "runwayml/stable-diffusion-v1-5")

        device = "cuda" if torch.cuda.is_available() else "cpu"
        dtype  = torch.float16 if device == "cuda" else torch.float32

        log.info(f"Using device={device}  model={model_id}")

        pipe = StableDiffusionPipeline.from_pretrained(
            model_id,
            torch_dtype=dtype,
            safety_checker=None,   # disabled for flexibility; re-enable in production
        )
        pipe.scheduler = DPMSolverMultistepScheduler.from_config(pipe.scheduler.config)

        # ── Optionally swap in the custom model components from stable_diffussion/ ──
        # Uncomment the lines below when you have fine-tuned weights for these components.
        # from stable_diffussion.vae            import Encoder, Decoder
        # from stable_diffussion.unet_2d_condition import UNet2DConditionModel as CustomUNet
        # pipe.vae.encoder  = Encoder(...)     # replace with custom encoder
        # pipe.unet         = CustomUNet(...)  # replace with custom unet

        pipe = pipe.to(device)
        if device == "cuda":
            pipe.enable_attention_slicing()
            try:
                pipe.enable_xformers_memory_efficient_attention()
            except Exception:
                pass

        _pipeline = pipe
        log.info("Pipeline ready ✓")
        return _pipeline

    except Exception as exc:
        log.error(f"Failed to load pipeline: {exc}")
        return None


# ── In-memory chat store (replace with SQLite/Redis for production) ────────────
# Structure: { chat_id: { "id", "title", "created_at", "messages": [...] } }
chats: dict = {}


def _new_chat(chat_id: str | None = None, title: str = "Nova Conversa") -> dict:
    cid = chat_id or str(uuid.uuid4())
    chats[cid] = {
        "id": cid,
        "title": title,
        "created_at": datetime.utcnow().isoformat(),
        "messages": [],
    }
    return chats[cid]


# ─────────────────────────────────────────────────────────────────────────────
#  ROUTES – Static
# ─────────────────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return send_from_directory("../frontend", "index.html")


# ─────────────────────────────────────────────────────────────────────────────
#  ROUTES – Chat management
# ─────────────────────────────────────────────────────────────────────────────

@app.route("/api/chats", methods=["GET"])
def list_chats():
    """Return all chats sorted by creation date (newest first)."""
    result = sorted(chats.values(), key=lambda c: c["created_at"], reverse=True)
    # Omit full messages in the listing for bandwidth
    lite = [{"id": c["id"], "title": c["title"], "created_at": c["created_at"]} for c in result]
    return jsonify({"chats": lite})


@app.route("/api/chats", methods=["POST"])
def create_chat():
    """Create a new empty chat session."""
    data = request.get_json(silent=True) or {}
    chat = _new_chat(title=data.get("title", "Nova Conversa"))
    return jsonify({"chat": chat}), 201


@app.route("/api/chats/<chat_id>", methods=["GET"])
def get_chat(chat_id):
    chat = chats.get(chat_id)
    if not chat:
        return jsonify({"error": "Chat não encontrado"}), 404
    return jsonify({"chat": chat})


@app.route("/api/chats/<chat_id>", methods=["DELETE"])
def delete_chat(chat_id):
    if chat_id not in chats:
        return jsonify({"error": "Chat não encontrado"}), 404
    del chats[chat_id]
    return jsonify({"ok": True})


@app.route("/api/chats/<chat_id>/title", methods=["PATCH"])
def rename_chat(chat_id):
    chat = chats.get(chat_id)
    if not chat:
        return jsonify({"error": "Chat não encontrado"}), 404
    data = request.get_json(silent=True) or {}
    chat["title"] = data.get("title", chat["title"])
    return jsonify({"chat": chat})


# ─────────────────────────────────────────────────────────────────────────────
#  ROUTES – Image generation
# ─────────────────────────────────────────────────────────────────────────────

@app.route("/api/generate", methods=["POST"])
def generate_image():
    """
    POST /api/generate
    Body JSON:
    {
        "chat_id":        "...",          # required – which chat to attach to
        "prompt":         "a red dragon", # required
        "negative_prompt":"...",          # optional
        "width":          512,            # optional, default 512
        "height":         512,            # optional, default 512
        "steps":          25,             # optional, default 25
        "guidance_scale": 7.5,            # optional, default 7.5
        "seed":           -1              # optional, -1 = random
    }
    Returns JSON with base64-encoded PNG and message metadata.
    """
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "JSON inválido"}), 400

    chat_id = data.get("chat_id")
    prompt  = (data.get("prompt") or "").strip()
    if not chat_id or not prompt:
        return jsonify({"error": "chat_id e prompt são obrigatórios"}), 400

    # Ensure chat exists
    if chat_id not in chats:
        _new_chat(chat_id=chat_id)

    # Parameters
    neg_prompt     = data.get("negative_prompt", "ugly, blurry, low quality, text, watermark")
    width          = max(128, min(int(data.get("width",  512)), 1024))
    height         = max(128, min(int(data.get("height", 512)), 1024))
    steps          = max(1,   min(int(data.get("steps",  25)),  150))
    guidance_scale = float(data.get("guidance_scale", 7.5))
    seed           = int(data.get("seed", -1))

    # Record user message
    user_msg = {
        "id":         str(uuid.uuid4()),
        "role":       "user",
        "type":       "text",
        "content":    prompt,
        "created_at": datetime.utcnow().isoformat(),
    }
    chats[chat_id]["messages"].append(user_msg)

    # Auto-title the chat from first prompt
    if len(chats[chat_id]["messages"]) == 1:
        title = prompt[:50] + ("…" if len(prompt) > 50 else "")
        chats[chat_id]["title"] = title

    # ── Load pipeline ──────────────────────────────────────────────────────────
    pipe = get_pipeline()
    if pipe is None:
        # Return demo/mock image when model is unavailable (dev mode)
        log.warning("Pipeline unavailable – returning mock image")
        image_b64 = _mock_image(prompt, width, height)
        status_msg = "⚠️ Modelo não carregado – imagem de demonstração gerada."
    else:
        try:
            import torch
            generator = torch.Generator().manual_seed(seed) if seed >= 0 else None

            with torch.inference_mode():
                result = pipe(
                    prompt=prompt,
                    negative_prompt=neg_prompt,
                    width=width,
                    height=height,
                    num_inference_steps=steps,
                    guidance_scale=guidance_scale,
                    generator=generator,
                )
            pil_img = result.images[0]
            buf = io.BytesIO()
            pil_img.save(buf, format="PNG")
            image_b64 = base64.b64encode(buf.getvalue()).decode()
            status_msg = None
        except Exception as exc:
            log.error(f"Generation error: {exc}")
            return jsonify({"error": f"Erro na geração: {str(exc)}"}), 500

    # Record assistant message
    assistant_msg = {
        "id":         str(uuid.uuid4()),
        "role":       "assistant",
        "type":       "image",
        "image_b64":  image_b64,
        "prompt":     prompt,
        "params": {
            "width": width, "height": height,
            "steps": steps, "guidance_scale": guidance_scale,
            "seed": seed, "negative_prompt": neg_prompt,
        },
        "status":     status_msg,
        "created_at": datetime.utcnow().isoformat(),
    }
    chats[chat_id]["messages"].append(assistant_msg)

    return jsonify({
        "message":   assistant_msg,
        "user_msg":  user_msg,
        "chat_id":   chat_id,
    })


# ─────────────────────────────────────────────────────────────────────────────
#  ROUTES – Model status
# ─────────────────────────────────────────────────────────────────────────────

@app.route("/api/status", methods=["GET"])
def model_status():
    try:
        import torch
        cuda = torch.cuda.is_available()
    except ImportError:
        cuda = False
    return jsonify({
        "model_loaded": _pipeline is not None,
        "cuda_available": cuda,
        "model_id": os.getenv("SD_MODEL_ID", "runwayml/stable-diffusion-v1-5"),
    })


# ─────────────────────────────────────────────────────────────────────────────
#  Helper – mock image (grayscale gradient + text overlay via PIL)
# ─────────────────────────────────────────────────────────────────────────────

def _mock_image(prompt: str, width: int, height: int) -> str:
    """Generate a placeholder image with the prompt text when the model is offline."""
    try:
        from PIL import Image, ImageDraw, ImageFont
        import numpy as np

        # Dark blue gradient background
        arr = np.zeros((height, width, 3), dtype=np.uint8)
        for y in range(height):
            r = int(5  + (y / height) * 15)
            g = int(10 + (y / height) * 20)
            b = int(40 + (y / height) * 60)
            arr[y, :] = [r, g, b]

        img  = Image.fromarray(arr, "RGB")
        draw = ImageDraw.Draw(img)

        # Draw a simple placeholder icon
        cx, cy, r = width // 2, height // 2 - 30, min(width, height) // 6
        draw.ellipse([cx - r, cy - r, cx + r, cy + r], outline=(80, 140, 255), width=3)
        draw.line([cx, cy + r, cx, cy + r + 20], fill=(80, 140, 255), width=3)
        draw.line([cx - 20, cy + r + 20, cx + 20, cy + r + 20], fill=(80, 140, 255), width=3)
        draw.line([cx - 15, cy + r + 5, cx - 30, cy + r + 30], fill=(80, 140, 255), width=3)
        draw.line([cx + 15, cy + r + 5, cx + 30, cy + r + 30], fill=(80, 140, 255), width=3)

        # Text
        label = f'"{prompt[:40]}{"…" if len(prompt)>40 else ""}"'
        draw.text((width // 2, height - 50), label, fill=(120, 160, 255), anchor="mm")
        draw.text((width // 2, height - 30), "[ Modo demonstração ]", fill=(80, 100, 160), anchor="mm")

        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return base64.b64encode(buf.getvalue()).decode()
    except Exception:
        # Fallback: tiny 1×1 transparent PNG
        return "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="


# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    port = int(os.getenv("PORT", 5000))
    log.info(f"Starting SD-ChatBot server on http://localhost:{port}")
    app.run(host="0.0.0.0", port=port, debug=False)
