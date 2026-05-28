from sqlalchemy import Column
from sqlalchemy import Integer
from sqlalchemy import String
from sqlalchemy import Float
from sqlalchemy import DateTime
from sqlalchemy.sql import func

from app.database.db import Base

class Transcript(Base):
    __tablename__ = "transcripts"

    id = Column(Integer, primary_key=True, index=True)

    filename = Column(String, nullable=False)

    transcript = Column(String, nullable=True)

    overall_score = Column(Float, default=0)

    created_at = Column(DateTime(timezone=True), server_default=func.now())