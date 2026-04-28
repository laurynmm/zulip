from django.db import models
from django.db.models import CASCADE
from typing_extensions import override

from corporate.models.plans import CustomerPlan


class LicenseLedger(models.Model):
    """
    This table's purpose is to store the current, and historical,
    count of "seats" purchased by the organization.

    Because we want to keep historical data, when the purchased
    seat count changes, a new LicenseLedger object is created,
    instead of updating the old one. This lets us preserve
    the entire history of how the seat count changes, which is
    important for analytics as well as auditing and debugging
    in case of issues.
    """

    plan = models.ForeignKey(CustomerPlan, on_delete=CASCADE)

    # Also True for the initial upgrade.
    is_renewal = models.BooleanField(default=False)

    event_time = models.DateTimeField()

    # The number of workplace user "licenses" purchased by the organization
    # at the time of ledger entry creation. Normally, to add a workplace user,
    # the organization needs at least one spare workplace user "license".
    # Once a "license" is purchased, it is valid till the end of the billing
    # period, irrespective of whether it is used or not. So the value of
    # current_workplace_count will never decrease for subsequent LicenseLedger
    # entries in the same billing period.
    current_workplace_count = models.IntegerField()

    # The number of workplace user "licenses" that the organization needs in
    # the next billing cycle. The value of next_renewal_workplace_count can
    # increase or decrease for subsequent LicenseLedger entries in the same
    # billing period. For plans on automatic license management this value is
    # usually equal to the number of workplace users in the organization.
    next_renewal_workplace_count = models.IntegerField(null=True)

    # For CustomerPlan objects with user_group_billing_enabled=True, i.e.,
    # discounted billing rates for non-workplace users, the number of
    # non-workplace user "spots" purchased by the organization at the time
    # of ledger entry created. These "spots" are purchased in bundles, so
    # this value will only increase when adding a user who is not in the
    # billing entity's workplace_users_group would require purchasing an
    # additional bundle of non-workplace user "spots". Should be null for
    # plans with user_group_billing_enabled=False.
    current_external_count = models.PositiveIntegerField(null=True)

    # For CustomerPlan objects with user_group_billing_enabled=True, i.e.,
    # discounted billing rates for non-workplace users,the number of
    # non-workplace user "spots" that the organization needs in the next
    # billing cycle. The value of next_renewal_external_count can increase or
    # decrease for subsequent LicenseLedger entries in the same billing period.
    # Should be null for plans with user_group_billing_enabled=False.
    next_renewal_external_count = models.PositiveIntegerField(null=True)

    @override
    def __str__(self) -> str:
        ledger_type = "renewal" if self.is_renewal else "update"
        ledger_time = self.event_time.replace(tzinfo=None).isoformat(" ", "minutes")
        workplace_counts = f"{self.current_workplace_count} purchased, {self.next_renewal_workplace_count} next cycle"
        if self.current_external_count is None:
            return f"License {ledger_type}, {workplace_counts}, {ledger_time} (id={self.id})"
        external_counts = f"{self.current_external_count} purchased, {self.next_renewal_external_count} next cycle"
        return f"License {ledger_type}, workplace: {workplace_counts}, non-workplace: {external_counts}, {ledger_time} (id={self.id})"
