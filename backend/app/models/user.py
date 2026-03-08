"""User model with role-based access control."""

import uuid
from datetime import datetime
from enum import Enum

from sqlalchemy import Boolean, DateTime, ForeignKey, LargeBinary, SmallInteger, String, func, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class UserRole(str, Enum):
    """User roles with increasing privilege levels."""
    SUPER_ADMIN = "super_admin"
    TENANT_ADMIN = "tenant_admin"
    OPERATOR = "operator"
    VIEWER = "viewer"


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=func.gen_random_uuid(),
    )
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    hashed_password: Mapped[str | None] = mapped_column(String(255), nullable=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        default=UserRole.VIEWER.value,
    )
    # tenant_id is nullable for super_admin users (portal-wide role)
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    # SRP zero-knowledge authentication columns (nullable during migration period)
    srp_salt: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    srp_verifier: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    auth_version: Mapped[int] = mapped_column(
        SmallInteger, server_default=text("1"), nullable=False
    )  # 1=bcrypt legacy, 2=SRP
    must_upgrade_auth: Mapped[bool] = mapped_column(
        Boolean, server_default=text("false"), nullable=False
    )  # True for bcrypt users who need SRP upgrade

    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    last_login: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    # Relationships
    tenant: Mapped["Tenant | None"] = relationship("Tenant", back_populates="users")  # type: ignore[name-defined]

    def __repr__(self) -> str:
        return f"<User id={self.id} email={self.email!r} role={self.role!r}>"
