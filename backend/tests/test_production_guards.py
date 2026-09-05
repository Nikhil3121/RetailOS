"""Configuration that must not be allowed to reach production.

The audit that produced these found that the CORS wildcard was guarded but the
JWT SIGNING KEY was not. That asymmetry was backwards: a wildcard CORS policy
is rejected by browsers when combined with credentials, whereas a default
signing key is silently exploitable — anyone who has read this repository could
mint a valid token for any user and call any endpoint as the owner.

So the signing key refuses to boot, and these tests are why it stays that way.
"""

from __future__ import annotations

import pytest

from app.main import _assert_signing_key_is_safe


class _Settings:
    """The two fields the guard reads. Avoids constructing real Settings,
    which would pull in a database URL and the whole environment."""

    def __init__(self, key: str, *, production: bool) -> None:
        self._key = key
        self.is_production = production

    @property
    def secret_key(self):  # noqa: ANN201 — mimics SecretStr's interface
        class _Secret:
            def __init__(self, v: str) -> None:
                self._v = v

            def get_secret_value(self) -> str:
                return self._v

        return _Secret(self._key)


def test_production_refuses_the_shipped_default() -> None:
    """`change-me` is in the public repo. It cannot sign a real token."""
    with pytest.raises(RuntimeError, match="placeholder"):
        _assert_signing_key_is_safe(_Settings("change-me", production=True))


@pytest.mark.parametrize("key", ["changeme", "secret", "test", "dev", "", "  CHANGE-ME  "])
def test_production_refuses_other_obvious_placeholders(key: str) -> None:
    """Case and surrounding whitespace must not smuggle a placeholder past."""
    with pytest.raises(RuntimeError):
        _assert_signing_key_is_safe(_Settings(key, production=True))


def test_production_refuses_the_env_example_placeholder() -> None:
    """The likeliest value to actually reach production.

    `.env.example` ships this string, and copying that file to `.env` is the
    first thing a deployer does. It is 68 characters, so a length check alone
    waves it straight through.
    """
    with pytest.raises(RuntimeError, match="placeholder"):
        _assert_signing_key_is_safe(
            _Settings(
                "change-me-in-real-deployments-please-generate-a-64-byte-urlsafe-token",
                production=True,
            )
        )


def test_production_refuses_a_short_key() -> None:
    with pytest.raises(RuntimeError, match="characters"):
        _assert_signing_key_is_safe(_Settings("a1b2c3d4", production=True))


def test_production_accepts_a_real_key() -> None:
    """32 hex characters, the shape `openssl rand -hex 32` produces."""
    _assert_signing_key_is_safe(
        _Settings("9f2a7c41b8e35d6079a4cc12ef8b3d5a", production=True)
    )


def test_development_is_left_alone() -> None:
    """The default must keep working locally, or every contributor is blocked
    behind a setup step for a threat that does not exist on their laptop."""
    _assert_signing_key_is_safe(_Settings("change-me", production=False))
