## converting cookies to file from browser.json

```bash
python3 -c '
import json
with open("browser.json") as f:
    data = json.load(f)

cookie_str = data.get("cookie", "") or data.get("Cookie", "")
if not cookie_str:
    print("No cookie field found in browser.json")
    exit(1)

with open("cookies.txt", "w") as out:
    out.write("# Netscape HTTP Cookie File\n# Generated from browser.json\n\n")
    for cookie in cookie_str.split("; "):
        if "=" in cookie:
            name, value = cookie.split("=", 1)
            secure = "TRUE" if name.startswith("__Secure-") else "FALSE"
            out.write(f".youtube.com\tTRUE\t/\t{secure}\t0\t{name}\t{value}\n")
print("Successfully created cookies.txt!")
'
```

## supported version of bun
```
WARNING: [youtube] [jsc:bun] bun version 1.4.2 is not supported! 1.3.14 is the last supported bun version. DO NOT open a bug report even if you encounter any errors!
```

## last command line
```
yt-dlp --cookies cookies.txt --quiet --js-runtimes bun -g -x -f bestaudio "https://music.youtube.com/watch?v=6hCqRb8Dtvo"
```

## get expiration date of url for caching
```py
from datetime import datetime
from urllib.parse import parse_qs, urlparse

url = "https://rr3---sn-vgqsrnzz.googlevideo.com/videoplayback?expire=1788040083&..."

parsed_url = urlparse(url)
query_params = parse_qs(parsed_url.query)
expire_timestamp = query_params.get("expire", [None])[0]

if expire_timestamp:
    expiry_date = (
        datetime.fromtimestamp(int(expire_timestamp)) - datetime.now()
    ).total_seconds()
    print(f"URL Expires at: {expiry_date}")
```

## caching the audio files in telegram channel
```py
import os
from pyrogram import Client

client = Client(
    "name",
    api_id=os.environ["API_ID"],
    api_hash=os.environ["API_HASH"].
    bot_token=os.environ["BOT_TOKEN"]
)

## init it in the lifespan
await client.start()

## download the webm file using yt-dlp url somehow in the format vidid.webm
msg = await client.send_document(
    os.environ["CHAT_ID"],
    f"{vid}.webm"
)

await redis.hset("vids", vid, msg.id)

## streaming already cached song
msg_id = int(await redis.hget("vids", vid))

message = await client.get_message(os.environ["CHAT_ID"], msg_id)

# Stream the whole media
async for chunk in app.stream_media(message):
    print(len(chunk))

# Stream the first 3 chunks only
async for chunk in app.stream_media(message, limit=3):
    print(len(chunk))

# Stream the rest of the media by skipping the first 3 chunks
async for chunk in app.stream_media(message, offset=3):
    print(len(chunk))

# Stream the last 3 chunks only (negative offset)
async for chunk in app.stream_media(message, offset=-3):
    print(len(chunk))
```
