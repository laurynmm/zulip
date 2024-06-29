# Zulip Bitbucket Server integration

Zulip supports both Git and Mercurial notifications from
Bitbucket. This integration is for the new-style Bitbucket
webhooks used by Bitbucket Server.

For the old-style Bitbucket webhooks used by Bitbucket Enterprise,
click [here](./bitbucket), and for the new-style webhooks used by
Bitbucket Cloud (SAAS service) click [here](./bitbucket2).

{start_tabs}

1. {!create-channel.md!}

1. {!create-an-incoming-webhook.md!}

1. {!generate-webhook-url-basic.md!}

1. On your repository's web page, select **Settings**.

1. Select **Webhooks**, and then select **Add webhook**.

1. Set **Title** to a title of your choice, such as `Zulip`.

1. Set **URL** to the URL generated above, and tobble the **Active**
   checkbox.

1. Select the **Triggers** you'd like to be notified about, and select
**Save**.

{end_tabs}

{!congrats.md!}

![](/static/images/integrations/bitbucket/004.png)

{% if all_event_types is defined %}

{!event-filtering-additional-feature.md!}

{% endif %}

### Configuration options

{!git-branches-additional-feature.md!}

### Related documentation

{!webhooks-url-specification.md!}
