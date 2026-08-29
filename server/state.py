from concurrent.futures import ThreadPoolExecutor

from redis.asyncio.client import Redis

executor: ThreadPoolExecutor = None
rds: Redis = None
