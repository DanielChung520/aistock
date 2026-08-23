from celery import Celery

celery_app = Celery(
    "aistock",
    broker="redis://localhost:6380/0",
    backend="redis://localhost:6380/0",
    include=["src.tasks.calc_volume_profile", "src.tasks.precompute_indicators", "src.tasks.backfill_daily", "src.tasks.research_download", "src.tasks.market_index_download", "src.tasks.feature_generate", "src.tasks.ai_training", "src.tasks.sensitivity", "src.tasks.tx_rl_training"],
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="Asia/Taipei",
    enable_utc=True,
)
