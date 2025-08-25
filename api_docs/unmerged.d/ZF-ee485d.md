* [`POST channels/create`](/api/create-channel): Removed the
  `send_new_subscription_messages` parameter from this endpoint because
  Notification Bot DMs are never sent to users who are subscribed to
  a channel during its creation process.
