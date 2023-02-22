from typing import Optional

from zerver.lib.user_status import update_user_status
from zerver.models import UserProfile, active_user_ids
from zerver.tornado.django_api import send_event


def do_update_user_status(
    user_profile: UserProfile,
    status_text: Optional[str],
    client_id: int,
    emoji_name: Optional[str],
    emoji_code: Optional[str],
    reaction_type: Optional[str],
) -> None:
    realm = user_profile.realm

    update_user_status(
        user_profile_id=user_profile.id,
        status_text=status_text,
        client_id=client_id,
        emoji_name=emoji_name,
        emoji_code=emoji_code,
        reaction_type=reaction_type,
    )

    event = dict(
        type="user_status",
        user_id=user_profile.id,
    )

    if status_text is not None:
        event["status_text"] = status_text

    if emoji_name is not None:
        event["emoji_name"] = emoji_name
        event["emoji_code"] = emoji_code
        event["reaction_type"] = reaction_type
    send_event(realm, event, active_user_ids(realm.id))
