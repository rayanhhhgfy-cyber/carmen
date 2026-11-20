# Carmen API — Docker image (used by Koyeb / Hugging Face Spaces).
# Same build steps as render.yaml: Deno for yt-dlp signature decryption,
# bgutil PO-token provider (branch 2.0.2), pip deps, then `python -m server`.
# The server reads $PORT (default 8000) and runs unauthenticated when no
# browser.json is present. Never commit browser.json or cookies.
FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl git ca-certificates unzip \
    && rm -rf /var/lib/apt/lists/*

# Deno (yt-dlp js_runtimes for stream-signature decryption)
RUN curl -fsSL https://deno.land/install.sh | DENO_INSTALL=/root/.deno sh
ENV PATH="/root/.deno/bin:$PATH"

# bgutil PO-token provider (optional: the server runs without it)
RUN git clone --single-branch --branch 2.0.2 https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git /app/bgutil-ytdlp-pot-provider \
    && (cd /app/bgutil-ytdlp-pot-provider/server && /root/.deno/bin/deno install --allow-scripts=npm:canvas --frozen || echo "bgutil deno install failed, continuing without PO tokens")

COPY server/requirements.txt server/requirements.txt
RUN pip install --no-cache-dir -r server/requirements.txt

COPY . .

EXPOSE 8000
CMD ["python", "-m", "server"]
