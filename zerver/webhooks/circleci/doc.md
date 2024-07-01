# Zulip CircleCI integration

Zulip supports integration with CircleCI and can notify you of your
job and workflow statuses. This integration currently supports using
CircleCI with GitHub, BitBucket and GitLab.

{start_tabs}

1. {!create-channel.md!}

1. {!create-an-incoming-webhook.md!}

1. {!generate-webhook-url-basic.md!}

1. Go to your project on CircleCI, select **Project Settings**.

1. Select **Webhooks** from the list on the left, and then select
   **Add Webhook**.

1. In the form that opens, give your webhook a name and set the
   **Receiver URL** field to the URL generated above.

1. Choose the desired events and finally select **Add Webhook**.

{end_tabs}

{!congrats.md!}

![](/static/images/integrations/circleci/001.png)
![](/static/images/integrations/circleci/002.png)

{% if all_event_types is defined %}

{!event-filtering-additional-feature.md!}

{% endif %}

### Related documentation

{!webhooks-url-specification.md!}
