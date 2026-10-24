"""Private selected-contact diagnostics and exact visible-ID resolution.

Only contact-directory metadata is queried. No nickname fallback, message table,
network, UI action, key access, or selector persistence. Public output is fixed
counts/flags/lengths; resolved account/username remain an explicit private object.
"""
from dataclasses import dataclass
import time

from macos_candidate_database_probe import need


KNOWN_COLUMNS=frozenset(("username","nick_name","remark","alias"))


def _value(value):
    need(isinstance(value,str) and 0<len(value)<=200 and not any(ord(c)<32 for c in value),
         "contact-selector-format-rejected")
    return value


def _columns(connection):
    columns={str(row[1]) for row in connection.execute("PRAGMA table_info(contact)")}
    need("username" in columns,"contact-directory-schema-unavailable")
    return columns


def _exact(column,parameter):
    return f'(typeof({column}) IN (\'text\',\'blob\') AND {column} COLLATE BINARY IN (:{parameter},:{parameter}_blob))'


def _expressions(columns):
    alias='"alias"' if "alias" in columns else "NULL"
    username='"username"'
    nick='"nick_name"' if "nick_name" in columns else "NULL"
    remark='"remark"' if "remark" in columns else "NULL"
    return alias,username,nick,remark


def diagnose_selector_from_source(source,selector,*,display=None):
    """Borrow a guarded source. This function never chooses a contact."""
    selector=_value(selector)
    if display is not None:display=_value(display)
    source.assert_unchanged()
    connection=source.contacts()
    columns=_columns(connection)
    alias,username,nick,remark=_expressions(columns)
    parameters={"expected":selector,"expected_blob":selector.encode("utf-8"),
                "display":display or "","display_blob":(display or "").encode("utf-8")}
    ea,eu=_exact(alias,"expected"),_exact(username,"expected")
    dn,dr=(_exact(nick,"display"),_exact(remark,"display")) if display is not None else ("0","0")
    ca=f'(typeof({alias}) IN (\'text\',\'blob\') AND CAST({alias} AS TEXT) COLLATE NOCASE=:expected AND NOT {ea})'
    cu=f'(typeof({username}) IN (\'text\',\'blob\') AND CAST({username} AS TEXT) COLLATE NOCASE=:expected AND NOT {eu})'
    expressions={"exactAliasRows":ea,"exactUsernameRows":eu,
        "exactAliasTextRows":f"({ea} AND typeof({alias})='text')",
        "exactAliasBlobRows":f"({ea} AND typeof({alias})='blob')",
        "exactUsernameTextRows":f"({eu} AND typeof({username})='text')",
        "exactUsernameBlobRows":f"({eu} AND typeof({username})='blob')",
        "aliasCaseVariantRows":ca,"usernameCaseVariantRows":cu,
        "displayNickExactRows":dn,"displayRemarkExactRows":dr,
        "displayCandidateRows":f"({dn} OR {dr})","visibleIdentifierMatchRows":f"({ea} OR {eu})"}
    sql="SELECT "+",".join(f"COALESCE(SUM(CASE WHEN {expression} THEN 1 ELSE 0 END),0)" for expression in expressions.values())
    sql+=f" FROM contact WHERE {ea} OR {eu} OR {ca} OR {cu} OR {dn} OR {dr}"
    rows=list(connection.execute(sql,parameters))
    need(len(rows)==1 and all(type(value)is int and 0<=value<=1_000_000 for value in rows[0]),"contact-diagnostic-count-rejected")
    result={"mode":"selected-contact-directory-diagnostic","schemaSupported":True,
        "knownColumns":sorted(columns&KNOWN_COLUMNS),"unknownColumnCount":len(columns-KNOWN_COLUMNS),
        **dict(zip(expressions,rows[0])),"caseVariantComparison":"ascii-only-diagnostic",
        "displayProvided":display is not None,"displayCandidates":[],"displayCandidatesTruncated":False,
        "selectedContactVerified":False,"selectionByNickname":False,"contentIncluded":False}
    if display is not None:
        # Only computed properties leave SQLite; no username/nickname/alias
        # values are fetched for these display candidates, and none select one.
        query=f"SELECT ({dn}),({dr}),typeof({alias}),({alias} IS NULL OR length(CAST({alias} AS BLOB))=0),"
        query+=f"length(CAST({alias} AS BLOB)),length(CAST({alias} AS TEXT)),({ea}),({ca}),({eu}) "
        query+=f"FROM contact WHERE {dn} OR {dr} LIMIT 21"
        candidates=list(connection.execute(query,parameters))
        result["displayCandidatesTruncated"]=len(candidates)>20
        for n,r,storage,empty,byte_length,char_length,exact,case_variant,username_exact in candidates[:20]:
            need(storage in ("text","blob","null","integer","real") and all(value is None or type(value)is int and value>=0
                for value in (byte_length,char_length)),"contact-diagnostic-shape-rejected")
            result["displayCandidates"].append({"nickExact":bool(n),"remarkExact":bool(r),"aliasStorage":storage,
                "aliasEmpty":bool(empty),"aliasBytes":byte_length,"aliasCharacters":char_length,
                "aliasEqualsExpected":bool(exact),"aliasCaseVariantOnly":bool(case_variant),"usernameEqualsExpected":bool(username_exact)})
    source.assert_unchanged()
    return result


def resolve_visible_identifier(source,selector):
    """Exact UTF-8 identifier in alias OR username; collisions always reject."""
    selector=_value(selector)
    source.assert_unchanged()
    connection=source.contacts()
    columns=_columns(connection)
    need({"username","nick_name","remark"}<=columns,"contact-directory-schema-unavailable")
    alias,username,_,_=_expressions(columns)
    where=f"{_exact(alias,'expected')} OR {_exact(username,'expected')}"
    rows=list(connection.execute(f"SELECT DISTINCT username COLLATE BINARY FROM contact WHERE {where} LIMIT 2",
                                 {"expected":selector,"expected_blob":selector.encode("utf-8")}))
    need(len(rows)==1,"selected-visible-identifier-unverified" if not rows else "selected-visible-identifier-collision")
    internal=rows[0][0]
    need(isinstance(internal,str),"selected-username-storage-unsupported")
    _value(internal)
    # Preserve the ordinary exact-username contract and reject duplicate or
    # inconsistent directory rows instead of arbitrarily picking a display.
    values=list(connection.execute("SELECT username,nick_name,remark FROM contact WHERE username COLLATE BINARY=? LIMIT 2",(internal,)))
    need(len(values)==1 and values[0][0]==internal,"selected-contact-unverified")
    source.assert_unchanged()
    return values[0]


@dataclass(frozen=True,repr=False)
class PrivateContactSelection:
    account_id:str
    contact_id:str

    def public(self):
        return {"selectedContactVerified":True,"selectionMethod":"exact-visible-identifier","selectionByNickname":False}


def diagnose_and_select(session,selector,*,display=None,on_diagnostics=None,on_stage=None):
    """Own one fresh source, diagnose then resolve within the same live lease."""
    need(on_diagnostics is None or callable(on_diagnostics),"contact-diagnostic-callback-rejected")
    need(on_stage is None or callable(on_stage),"contact-diagnostic-callback-rejected")
    started=last=time.monotonic()
    def stage(name):
        nonlocal last
        now=time.monotonic()
        if on_stage is not None:on_stage({"stage":name,"elapsedSeconds":round(now-started,2),"stageSeconds":round(now-last,2)})
        last=now
    source=session.open_source()
    try:
        stage("contact-source-opened")
        diagnostics=diagnose_selector_from_source(source,selector,display=display)
        stage("contact-diagnostics-completed")
        if on_diagnostics is not None:on_diagnostics(diagnostics)
        row=resolve_visible_identifier(source,selector)
        need(row[0]!=source.self_username and not row[0].endswith("@chatroom"),"selected-contact-rejected")
        result=PrivateContactSelection(source.account_id,row[0])
        source.assert_unchanged()
        stage("contact-identifier-verified")
    finally:source.close()
    session.verify_scope()
    stage("contact-selection-sealed")
    return result
