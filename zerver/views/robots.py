from django.conf import settings
from django.http import HttpRequest, HttpResponse
from django.views.decorators.http import require_GET


@require_GET
def robots_txt(request: HttpRequest) -> HttpResponse:
    if settings.CORPORATE_ENABLED:
        lines = [
            "User-Agent: *",
            "Disallow: /attribution/",
        ]
    else:
        lines = [
            "User-Agent: *",
            "Disallow: /",
            "Allow: /$",
        ]

    return HttpResponse("\n".join(lines), content_type="text/plain")
