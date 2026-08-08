from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .database import Base, engine
from . import models  # noqa: F401  (テーブル定義をBase.metadataに登録するため)
from .routers import members, availability, quotas, fixed_slots, schedule, auth

Base.metadata.create_all(bind=engine)

app = FastAPI(title="当直表自動作成ツール API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 開発用。デプロイ時はフロントのオリジンに絞る。
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(members.router)
app.include_router(availability.router)
app.include_router(quotas.router)
app.include_router(fixed_slots.router)
app.include_router(schedule.router)
app.include_router(auth.router)


@app.get("/health")
def health():
    return {"status": "ok"}
