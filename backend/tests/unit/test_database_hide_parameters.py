"""Guard test: DB errors must never leak bound parameter values.

str(DBAPIError) embeds bound query parameters by default, and a device
insert binds encrypted_credentials_transit -- so any unhandled DB error
(anywhere app-wide, since every DBAPIError formats itself the same way)
would write OpenBao Transit ciphertext straight into the server log. This
was closed by setting hide_parameters=True on both engines in
app/database.py.

hide_parameters only redacts *parameter values*; the SQL statement text is
still logged in full, so errors stay diagnosable. This test proves both
halves of that claim directly against SQLAlchemy's own error formatting,
without needing a live database connection.

This is pure exception-formatting logic -- no database or async required.
"""

from sqlalchemy.exc import DBAPIError

from app.database import app_engine, engine


def test_engines_have_hide_parameters_enabled():
    """Both engines must redact bound parameters in error output.

    create_async_engine() returns an AsyncEngine wrapper; hide_parameters
    lives on the underlying sync Engine it wraps.
    """
    assert engine.sync_engine.hide_parameters is True
    assert app_engine.sync_engine.hide_parameters is True


def test_dbapi_error_hides_parameter_values_but_keeps_statement():
    """A DBAPIError built the way SQLAlchemy actually builds them (see
    Connection._handle_dbapi_exception) must not surface a bound value in
    str(exc), while the SQL statement text remains visible for debugging.
    """
    statement = (
        "INSERT INTO devices (encrypted_credentials_transit) "
        "VALUES (%(encrypted_credentials_transit)s)"
    )
    ciphertext_marker = "vault:v1:SECRET-CIPHERTEXT-MARKER"
    params = {"encrypted_credentials_transit": ciphertext_marker}
    orig = Exception("duplicate key value violates unique constraint")

    hidden = DBAPIError.instance(statement, params, orig, Exception, hide_parameters=True)
    rendered = str(hidden)

    assert ciphertext_marker not in rendered, "bound parameter value leaked into the error string"
    assert "devices" in rendered, "SQL statement text should still be present for diagnosis"
    assert "hidden due to hide_parameters" in rendered


def test_dbapi_error_without_hide_parameters_would_have_leaked():
    """Sanity check that the marker in the test above is actually load-bearing --
    without hide_parameters, the same construction leaks the value. If this
    ever stops leaking, the test above may be passing for the wrong reason.
    """
    statement = "INSERT INTO devices (encrypted_credentials_transit) VALUES (%(v)s)"
    ciphertext_marker = "vault:v1:SECRET-CIPHERTEXT-MARKER"
    params = {"v": ciphertext_marker}
    orig = Exception("duplicate key value violates unique constraint")

    shown = DBAPIError.instance(statement, params, orig, Exception, hide_parameters=False)

    assert ciphertext_marker in str(shown)
