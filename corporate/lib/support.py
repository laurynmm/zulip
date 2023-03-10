from urllib.parse import urlencode, urljoin, urlunsplit

from django.conf import settings
from django.urls import reverse

from zerver.models import Realm, get_realm


def get_support_url(realm: Realm) -> str:
    support_realm_uri = get_realm(settings.STAFF_SUBDOMAIN).uri
    support_url = urljoin(
        support_realm_uri,
        urlunsplit(("", "", reverse("support"), urlencode({"q": realm.string_id}), "")),
    )
    return support_url


def get_plan_name(plan_type: int) -> str:
    return {
        Realm.PLAN_TYPE_SELF_HOSTED: "self-hosted",
        Realm.PLAN_TYPE_LIMITED: "limited",
        Realm.PLAN_TYPE_STANDARD: "standard",
        Realm.PLAN_TYPE_STANDARD_FREE: "open source",
        Realm.PLAN_TYPE_PLUS: "plus",
    }[plan_type]
