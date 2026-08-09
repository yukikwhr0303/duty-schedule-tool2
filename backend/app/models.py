from datetime import date, datetime
from typing import Optional, List

from sqlalchemy import String, Boolean, Integer, Date, DateTime, ForeignKey, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


class Member(Base):
    """医局員。rank: 'A' = 上級医, 'B' = 下級医"""
    __tablename__ = "members"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    rank: Mapped[str] = mapped_column(String(1))  # "A" or "B"
    pin_hash: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)  # 初回ログイン時に本人が設定
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)  # False: 外病院配属などで一時的に対象外
    sort_order: Mapped[int] = mapped_column(Integer, default=0)  # 表示順(管理者が並び替え可能)

    availabilities: Mapped[List["Availability"]] = relationship(
        back_populates="member", cascade="all, delete-orphan"
    )
    quotas: Mapped[List["Quota"]] = relationship(
        back_populates="member", cascade="all, delete-orphan"
    )
    fixed_slots: Mapped[List["FixedSlot"]] = relationship(
        back_populates="member", cascade="all, delete-orphan"
    )

    @property
    def has_pin(self) -> bool:
        return self.pin_hash is not None


class Availability(Base):
    """メンバー個人ごとの「不可」設定。行が存在する = その枠・その役割は不可。"""
    __tablename__ = "availability"
    __table_args__ = (UniqueConstraint("member_id", "date", "half", name="uq_avail_member_date_half"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    member_id: Mapped[int] = mapped_column(ForeignKey("members.id", ondelete="CASCADE"))
    date: Mapped[date] = mapped_column(Date, index=True)
    half: Mapped[str] = mapped_column(String(3))  # "ALL" / "AM" / "PM"
    duty_ng: Mapped[bool] = mapped_column(Boolean, default=False)
    oncall_ng: Mapped[bool] = mapped_column(Boolean, default=False)
    note: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)  # 本人が残せる自由記述コメント

    member: Mapped["Member"] = relationship(back_populates="availabilities")


class AvailabilitySubmission(Base):
    """「この内容で提出する」を押した記録。対象月ごとに1件。
    全部「可」で保存対象の行が無い月でも、これがあれば「提出済み」と判定できる。"""
    __tablename__ = "availability_submissions"
    __table_args__ = (
        UniqueConstraint("member_id", "period_start", "period_days", name="uq_submission_member_period"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    member_id: Mapped[int] = mapped_column(ForeignKey("members.id", ondelete="CASCADE"))
    period_start: Mapped[date] = mapped_column(Date, index=True)
    period_days: Mapped[int] = mapped_column(Integer)
    submitted_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    member: Mapped["Member"] = relationship()


class NgPair(Base):
    """「この2人は当直/オンコールで同じ日に組ませない」というNGペア設定。
    向きは問わない(どちらが当直/オンコールでも組み合わせ自体を禁止)。
    member_a_id < member_b_id となるよう常に正規化して保存し、重複登録を防ぐ。"""
    __tablename__ = "ng_pairs"
    __table_args__ = (UniqueConstraint("member_a_id", "member_b_id", name="uq_ng_pair"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    member_a_id: Mapped[int] = mapped_column(ForeignKey("members.id", ondelete="CASCADE"))
    member_b_id: Mapped[int] = mapped_column(ForeignKey("members.id", ondelete="CASCADE"))

    member_a: Mapped["Member"] = relationship(foreign_keys=[member_a_id])
    member_b: Mapped["Member"] = relationship(foreign_keys=[member_b_id])


class Quota(Base):
    """対象期間ごとのメンバー別 希望回数(当直/オンコール)。"""
    __tablename__ = "quotas"
    __table_args__ = (
        UniqueConstraint("member_id", "period_start", "period_days", name="uq_quota_member_period"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    member_id: Mapped[int] = mapped_column(ForeignKey("members.id", ondelete="CASCADE"))
    period_start: Mapped[date] = mapped_column(Date, index=True)
    period_days: Mapped[int] = mapped_column(Integer)
    duty_quota: Mapped[int] = mapped_column(Integer, default=0)
    oncall_quota: Mapped[int] = mapped_column(Integer, default=0)

    member: Mapped["Member"] = relationship(back_populates="quotas")


class FixedSlot(Base):
    """事前固定配置。特定日・特定枠・特定役割を特定メンバーで固定する。"""
    __tablename__ = "fixed_slots"
    __table_args__ = (UniqueConstraint("date", "half", "role", name="uq_fixed_date_half_role"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    date: Mapped[date] = mapped_column(Date, index=True)
    half: Mapped[str] = mapped_column(String(3))  # "ALL" / "AM" / "PM"
    role: Mapped[str] = mapped_column(String(6))  # "duty" / "oncall"
    member_id: Mapped[int] = mapped_column(ForeignKey("members.id", ondelete="CASCADE"))

    member: Mapped["Member"] = relationship(back_populates="fixed_slots")


class ScheduleRun(Base):
    """自動割当を1回実行した記録。"""
    __tablename__ = "schedule_runs"

    id: Mapped[int] = mapped_column(primary_key=True)
    start_date: Mapped[date] = mapped_column(Date)
    days: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(20))  # OPTIMAL / FEASIBLE / INFEASIBLE / ERROR
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    assignments: Mapped[List["Assignment"]] = relationship(
        back_populates="run", cascade="all, delete-orphan"
    )


class Assignment(Base):
    """割当結果1枠分。member_id が None の場合は空欄(unfilled_reason に理由)。"""
    __tablename__ = "assignments"

    id: Mapped[int] = mapped_column(primary_key=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("schedule_runs.id", ondelete="CASCADE"))
    date: Mapped[date] = mapped_column(Date, index=True)
    half: Mapped[str] = mapped_column(String(3))
    role: Mapped[str] = mapped_column(String(6))  # "duty" / "oncall"
    member_id: Mapped[Optional[int]] = mapped_column(ForeignKey("members.id", ondelete="SET NULL"), nullable=True)
    fixed: Mapped[bool] = mapped_column(Boolean, default=False)
    manual_override: Mapped[bool] = mapped_column(Boolean, default=False)
    unfilled_reason: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)

    run: Mapped["ScheduleRun"] = relationship(back_populates="assignments")
    member: Mapped[Optional["Member"]] = relationship()
