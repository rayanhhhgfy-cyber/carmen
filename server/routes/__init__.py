from fastapi import APIRouter

from .browsing import router as browsing_router
from .playlists import router as playlists_router
from .podcasts import router as podcasts_router
from .search import router as search_router
from .watch import router as watch_router

router = APIRouter()
router.include_router(browsing_router)
router.include_router(search_router)
router.include_router(watch_router)
router.include_router(podcasts_router)
router.include_router(playlists_router)
