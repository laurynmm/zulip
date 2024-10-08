# Generated by Django 5.0.7 on 2024-08-13 21:48

import bitfield.models
import django.contrib.auth.models
import django.contrib.postgres.indexes
import django.contrib.postgres.search
import django.core.validators
import django.db.models.deletion
import django.db.models.functions.text
import django.utils.timezone
from django.conf import settings
from django.db import migrations, models

from zerver.models.streams import generate_email_token_for_stream


class Migration(migrations.Migration):
    initial = True

    dependencies = [
        ("auth", "0001_initial"),
    ]

    if settings.POSTGRESQL_MISSING_DICTIONARIES:
        fts_sql = """
CREATE TEXT SEARCH CONFIGURATION zulip.english_us_search (COPY=pg_catalog.english);
"""
    else:
        fts_sql = """
CREATE TEXT SEARCH DICTIONARY english_us_hunspell
  (template = ispell, DictFile = en_us, AffFile = en_us, StopWords = zulip_english);
CREATE TEXT SEARCH CONFIGURATION zulip.english_us_search (COPY=pg_catalog.english);
ALTER TEXT SEARCH CONFIGURATION zulip.english_us_search
  ALTER MAPPING FOR asciiword, asciihword, hword_asciipart, word, hword, hword_part
  WITH english_us_hunspell, english_stem;
"""

    fts_sql += """

CREATE FUNCTION escape_html(text) RETURNS text IMMUTABLE LANGUAGE 'sql' AS $$
  SELECT replace(replace(replace(replace(replace($1, '&', '&amp;'), '<', '&lt;'),
                                 '>', '&gt;'), '"', '&quot;'), '''', '&#39;');
$$ ;

CREATE TABLE fts_update_log (id SERIAL PRIMARY KEY, message_id INTEGER NOT NULL);
CREATE FUNCTION do_notify_fts_update_log() RETURNS trigger LANGUAGE plpgsql AS
  $$ BEGIN NOTIFY fts_update_log; RETURN NEW; END $$;
CREATE TRIGGER fts_update_log_notify AFTER INSERT ON fts_update_log
  FOR EACH STATEMENT EXECUTE PROCEDURE do_notify_fts_update_log();
CREATE FUNCTION append_to_fts_update_log() RETURNS trigger LANGUAGE plpgsql AS
  $$ BEGIN INSERT INTO fts_update_log (message_id) VALUES (NEW.id); RETURN NEW; END $$;
CREATE TRIGGER zerver_message_update_search_tsvector_async
  BEFORE INSERT OR UPDATE OF subject, rendered_content ON zerver_message
  FOR EACH ROW EXECUTE PROCEDURE append_to_fts_update_log();
"""

    operations = [
        migrations.CreateModel(
            name="Recipient",
            fields=[
                (
                    "id",
                    models.AutoField(
                        auto_created=True, primary_key=True, serialize=False, verbose_name="ID"
                    ),
                ),
                ("type_id", models.IntegerField(db_index=True)),
                ("type", models.PositiveSmallIntegerField(db_index=True)),
            ],
            options={
                "unique_together": {("type", "type_id")},
            },
        ),
        migrations.CreateModel(
            name="Huddle",
            fields=[
                (
                    "id",
                    models.AutoField(
                        auto_created=True, primary_key=True, serialize=False, verbose_name="ID"
                    ),
                ),
                ("huddle_hash", models.CharField(db_index=True, max_length=40, unique=True)),
            ],
        ),
        migrations.CreateModel(
            name="Realm",
            fields=[
                (
                    "id",
                    models.AutoField(
                        auto_created=True, primary_key=True, serialize=False, verbose_name="ID"
                    ),
                ),
                ("domain", models.CharField(db_index=True, max_length=40, unique=True)),
                ("name", models.CharField(max_length=40, null=True)),
                ("restricted_to_domain", models.BooleanField(default=True)),
                ("invite_required", models.BooleanField(default=False)),
                ("invite_by_admins_only", models.BooleanField(default=False)),
                ("mandatory_topics", models.BooleanField(default=False)),
                ("show_digest_email", models.BooleanField(default=True)),
                ("name_changes_disabled", models.BooleanField(default=False)),
                ("date_created", models.DateTimeField(default=django.utils.timezone.now)),
                ("deactivated", models.BooleanField(default=False)),
                ("create_stream_by_admins_only", models.BooleanField(default=False)),
                ("allow_message_editing", models.BooleanField(default=True)),
                ("message_content_edit_limit_seconds", models.IntegerField(default=600)),
                ("default_language", models.CharField(default="en", max_length=50)),
            ],
            options={
                "permissions": (
                    ("administer", "Administer a realm"),
                    ("api_super_user", "Can send messages as other users for mirroring"),
                ),
            },
        ),
        migrations.CreateModel(
            name="RealmAlias",
            fields=[
                (
                    "id",
                    models.AutoField(
                        auto_created=True, primary_key=True, serialize=False, verbose_name="ID"
                    ),
                ),
                ("domain", models.CharField(db_index=True, max_length=80, unique=True)),
                (
                    "realm",
                    models.ForeignKey(
                        null=True, on_delete=django.db.models.deletion.CASCADE, to="zerver.realm"
                    ),
                ),
            ],
        ),
        migrations.CreateModel(
            name="ScheduledJob",
            fields=[
                (
                    "id",
                    models.AutoField(
                        auto_created=True, primary_key=True, serialize=False, verbose_name="ID"
                    ),
                ),
                ("scheduled_timestamp", models.DateTimeField()),
                ("type", models.PositiveSmallIntegerField()),
                ("data", models.TextField()),
                ("filter_id", models.IntegerField(null=True)),
                ("filter_string", models.CharField(max_length=100)),
            ],
        ),
        migrations.CreateModel(
            name="Client",
            fields=[
                (
                    "id",
                    models.AutoField(
                        auto_created=True, primary_key=True, serialize=False, verbose_name="ID"
                    ),
                ),
                ("name", models.CharField(db_index=True, max_length=30, unique=True)),
            ],
        ),
        migrations.CreateModel(
            name="UserProfile",
            fields=[
                (
                    "id",
                    models.AutoField(
                        auto_created=True, primary_key=True, serialize=False, verbose_name="ID"
                    ),
                ),
                ("password", models.CharField(max_length=128, verbose_name="password")),
                (
                    "last_login",
                    models.DateTimeField(blank=True, null=True, verbose_name="last login"),
                ),
                (
                    "is_superuser",
                    models.BooleanField(
                        default=False,
                        help_text="Designates that this user has all permissions without explicitly assigning them.",
                        verbose_name="superuser status",
                    ),
                ),
                ("email", models.EmailField(db_index=True, max_length=254, unique=True)),
                ("is_staff", models.BooleanField(default=False)),
                ("is_active", models.BooleanField(db_index=True, default=True)),
                ("is_bot", models.BooleanField(db_index=True, default=False)),
                ("date_joined", models.DateTimeField(default=django.utils.timezone.now)),
                ("is_mirror_dummy", models.BooleanField(default=False)),
                ("full_name", models.CharField(max_length=100)),
                ("short_name", models.CharField(max_length=100)),
                ("pointer", models.IntegerField()),
                ("last_pointer_updater", models.CharField(max_length=64)),
                ("api_key", models.CharField(max_length=32)),
                ("enable_stream_desktop_notifications", models.BooleanField(default=False)),
                ("enable_stream_sounds", models.BooleanField(default=False)),
                ("enable_desktop_notifications", models.BooleanField(default=True)),
                ("enable_sounds", models.BooleanField(default=True)),
                ("enable_offline_email_notifications", models.BooleanField(default=True)),
                ("enable_offline_push_notifications", models.BooleanField(default=True)),
                ("enable_digest_emails", models.BooleanField(default=True)),
                ("default_desktop_notifications", models.BooleanField(default=True)),
                (
                    "last_reminder",
                    models.DateTimeField(default=django.utils.timezone.now, null=True),
                ),
                ("rate_limits", models.CharField(default="", max_length=100)),
                ("default_all_public_streams", models.BooleanField(default=False)),
                ("enter_sends", models.BooleanField(default=True, null=True)),
                ("autoscroll_forever", models.BooleanField(default=False)),
                ("twenty_four_hour_time", models.BooleanField(default=False)),
                (
                    "avatar_source",
                    models.CharField(
                        choices=[
                            ("G", "Hosted by Gravatar"),
                            ("U", "Uploaded by user"),
                            ("S", "System generated"),
                        ],
                        default="G",
                        max_length=1,
                    ),
                ),
                (
                    "tutorial_status",
                    models.CharField(
                        choices=[("W", "Waiting"), ("S", "Started"), ("F", "Finished")],
                        default="W",
                        max_length=1,
                    ),
                ),
                ("onboarding_steps", models.TextField(default="[]")),
                ("invites_granted", models.IntegerField(default=0)),
                ("invites_used", models.IntegerField(default=0)),
                ("alert_words", models.TextField(default="[]")),
                ("muted_topics", models.TextField(default="[]")),
                (
                    "bot_owner",
                    models.ForeignKey(
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "groups",
                    models.ManyToManyField(
                        blank=True,
                        help_text="The groups this user belongs to. A user will get all permissions granted to each of their groups.",
                        related_name="user_set",
                        related_query_name="user",
                        to="auth.group",
                        verbose_name="groups",
                    ),
                ),
                (
                    "realm",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE, to="zerver.realm"
                    ),
                ),
                (
                    "user_permissions",
                    models.ManyToManyField(
                        blank=True,
                        help_text="Specific permissions for this user.",
                        related_name="user_set",
                        related_query_name="user",
                        to="auth.permission",
                        verbose_name="user permissions",
                    ),
                ),
                ("left_side_userlist", models.BooleanField(default=False)),
                ("is_api_super_user", models.BooleanField(db_index=True, default=False)),
                ("is_realm_admin", models.BooleanField(db_index=True, default=False)),
                ("bot_type", models.PositiveSmallIntegerField(db_index=True, null=True)),
                ("default_language", models.CharField(default="en", max_length=50)),
                ("tos_version", models.CharField(max_length=10, null=True)),
            ],
            options={
                "abstract": False,
            },
        ),
        migrations.CreateModel(
            name="Message",
            fields=[
                (
                    "id",
                    models.AutoField(
                        auto_created=True, primary_key=True, serialize=False, verbose_name="ID"
                    ),
                ),
                ("subject", models.CharField(db_index=True, max_length=60)),
                ("content", models.TextField()),
                ("rendered_content", models.TextField(null=True)),
                ("rendered_content_version", models.IntegerField(null=True)),
                ("pub_date", models.DateTimeField(db_index=True, verbose_name="date published")),
                ("last_edit_time", models.DateTimeField(null=True)),
                ("edit_history", models.TextField(null=True)),
                ("has_attachment", models.BooleanField(db_index=True, default=False)),
                ("has_image", models.BooleanField(db_index=True, default=False)),
                ("has_link", models.BooleanField(db_index=True, default=False)),
                (
                    "recipient",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE, to="zerver.recipient"
                    ),
                ),
                (
                    "sender",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE, to=settings.AUTH_USER_MODEL
                    ),
                ),
                (
                    "sending_client",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE, to="zerver.client"
                    ),
                ),
                ("search_tsvector", django.contrib.postgres.search.SearchVectorField(null=True)),
            ],
        ),
        migrations.CreateModel(
            name="UserActivityInterval",
            fields=[
                (
                    "id",
                    models.AutoField(
                        auto_created=True, primary_key=True, serialize=False, verbose_name="ID"
                    ),
                ),
                ("start", models.DateTimeField(db_index=True, verbose_name="start time")),
                ("end", models.DateTimeField(db_index=True, verbose_name="end time")),
                (
                    "user_profile",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE, to=settings.AUTH_USER_MODEL
                    ),
                ),
            ],
        ),
        migrations.CreateModel(
            name="UserPresence",
            fields=[
                (
                    "id",
                    models.AutoField(
                        auto_created=True, primary_key=True, serialize=False, verbose_name="ID"
                    ),
                ),
                ("timestamp", models.DateTimeField(verbose_name="presence changed")),
                ("status", models.PositiveSmallIntegerField(default=1)),
                (
                    "client",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE, to="zerver.client"
                    ),
                ),
                (
                    "user_profile",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE, to=settings.AUTH_USER_MODEL
                    ),
                ),
            ],
            options={
                "unique_together": {("user_profile", "client")},
            },
        ),
        migrations.CreateModel(
            name="UserMessage",
            fields=[
                (
                    "id",
                    models.AutoField(
                        auto_created=True, primary_key=True, serialize=False, verbose_name="ID"
                    ),
                ),
                (
                    "flags",
                    bitfield.models.BitField(
                        [
                            "read",
                            "starred",
                            "collapsed",
                            "mentioned",
                            "wildcard_mentioned",
                            "summarize_in_home",
                            "summarize_in_stream",
                            "force_expand",
                            "force_collapse",
                            "has_alert_word",
                            "historical",
                            "is_me_message",
                        ],
                        default=0,
                    ),
                ),
                (
                    "message",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE, to="zerver.message"
                    ),
                ),
                (
                    "user_profile",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE, to=settings.AUTH_USER_MODEL
                    ),
                ),
            ],
            options={
                "unique_together": {("user_profile", "message")},
            },
        ),
        migrations.CreateModel(
            name="UserActivity",
            fields=[
                (
                    "id",
                    models.AutoField(
                        auto_created=True, primary_key=True, serialize=False, verbose_name="ID"
                    ),
                ),
                ("query", models.CharField(db_index=True, max_length=50)),
                ("count", models.IntegerField()),
                ("last_visit", models.DateTimeField(verbose_name="last visit")),
                (
                    "client",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE, to="zerver.client"
                    ),
                ),
                (
                    "user_profile",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE, to=settings.AUTH_USER_MODEL
                    ),
                ),
            ],
            options={
                "unique_together": {("user_profile", "client", "query")},
            },
        ),
        migrations.CreateModel(
            name="Stream",
            fields=[
                (
                    "id",
                    models.AutoField(
                        auto_created=True, primary_key=True, serialize=False, verbose_name="ID"
                    ),
                ),
                ("name", models.CharField(db_index=True, max_length=60)),
                ("invite_only", models.BooleanField(default=False, null=True)),
                (
                    "email_token",
                    models.CharField(default=generate_email_token_for_stream, max_length=32),
                ),
                ("description", models.CharField(default="", max_length=1024)),
                ("date_created", models.DateTimeField(default=django.utils.timezone.now)),
                ("deactivated", models.BooleanField(default=False)),
                (
                    "realm",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE, to="zerver.realm"
                    ),
                ),
            ],
            options={
                "unique_together": {("name", "realm")},
            },
        ),
        migrations.CreateModel(
            name="RealmFilter",
            fields=[
                (
                    "id",
                    models.AutoField(
                        auto_created=True, primary_key=True, serialize=False, verbose_name="ID"
                    ),
                ),
                ("pattern", models.TextField()),
                ("url_format_string", models.TextField()),
                (
                    "realm",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE, to="zerver.realm"
                    ),
                ),
            ],
            options={
                "unique_together": {("realm", "pattern")},
            },
        ),
        migrations.CreateModel(
            name="DefaultStream",
            fields=[
                (
                    "id",
                    models.AutoField(
                        auto_created=True, primary_key=True, serialize=False, verbose_name="ID"
                    ),
                ),
                (
                    "realm",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE, to="zerver.realm"
                    ),
                ),
                (
                    "stream",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE, to="zerver.stream"
                    ),
                ),
            ],
            options={
                "unique_together": {("realm", "stream")},
            },
        ),
        migrations.CreateModel(
            name="PushDeviceToken",
            fields=[
                (
                    "id",
                    models.AutoField(
                        auto_created=True, primary_key=True, serialize=False, verbose_name="ID"
                    ),
                ),
                ("kind", models.PositiveSmallIntegerField(choices=[(1, "apns"), (2, "gcm")])),
                ("token", models.CharField(max_length=4096, unique=True)),
                ("last_updated", models.DateTimeField(auto_now=True)),
                ("ios_app_id", models.TextField(null=True)),
                (
                    "user",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE, to=settings.AUTH_USER_MODEL
                    ),
                ),
            ],
        ),
        migrations.CreateModel(
            name="Referral",
            fields=[
                (
                    "id",
                    models.AutoField(
                        auto_created=True, primary_key=True, serialize=False, verbose_name="ID"
                    ),
                ),
                ("email", models.EmailField(max_length=254)),
                ("timestamp", models.DateTimeField(auto_now_add=True)),
                (
                    "user_profile",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE, to=settings.AUTH_USER_MODEL
                    ),
                ),
            ],
        ),
        migrations.CreateModel(
            name="RealmEmoji",
            fields=[
                (
                    "id",
                    models.AutoField(
                        auto_created=True, primary_key=True, serialize=False, verbose_name="ID"
                    ),
                ),
                (
                    "name",
                    models.TextField(
                        validators=[
                            django.core.validators.MinLengthValidator(1),
                            django.core.validators.RegexValidator(
                                message="Invalid characters in emoji name",
                                regex="^[0-9a-zA-Z.\\-_]+(?<![.\\-_])$",
                            ),
                        ]
                    ),
                ),
                ("img_url", models.URLField(max_length=1000)),
                (
                    "realm",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE, to="zerver.realm"
                    ),
                ),
            ],
            options={
                "unique_together": {("realm", "name")},
            },
        ),
        migrations.CreateModel(
            name="PreregistrationUser",
            fields=[
                (
                    "id",
                    models.AutoField(
                        auto_created=True, primary_key=True, serialize=False, verbose_name="ID"
                    ),
                ),
                ("email", models.EmailField(max_length=254)),
                ("invited_at", models.DateTimeField(auto_now=True)),
                ("status", models.IntegerField(default=0)),
                (
                    "realm",
                    models.ForeignKey(
                        null=True, on_delete=django.db.models.deletion.CASCADE, to="zerver.realm"
                    ),
                ),
                (
                    "referred_by",
                    models.ForeignKey(
                        null=True,
                        on_delete=django.db.models.deletion.CASCADE,
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                ("realm_creation", models.BooleanField(default=False)),
            ],
        ),
        migrations.CreateModel(
            name="Attachment",
            fields=[
                (
                    "id",
                    models.AutoField(
                        auto_created=True, primary_key=True, serialize=False, verbose_name="ID"
                    ),
                ),
                ("file_name", models.CharField(db_index=True, max_length=100)),
                ("path_id", models.TextField(db_index=True)),
                (
                    "create_time",
                    models.DateTimeField(db_index=True, default=django.utils.timezone.now),
                ),
                ("messages", models.ManyToManyField(to="zerver.message")),
                (
                    "owner",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE, to=settings.AUTH_USER_MODEL
                    ),
                ),
                ("is_realm_public", models.BooleanField(default=False)),
                (
                    "realm",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.CASCADE,
                        to="zerver.realm",
                    ),
                ),
            ],
        ),
        migrations.CreateModel(
            name="Subscription",
            fields=[
                (
                    "id",
                    models.AutoField(
                        auto_created=True, primary_key=True, serialize=False, verbose_name="ID"
                    ),
                ),
                ("active", models.BooleanField(default=True)),
                ("in_home_view", models.BooleanField(default=True, null=True)),
                ("color", models.CharField(default="#c2c2c2", max_length=10)),
                ("desktop_notifications", models.BooleanField(default=True)),
                ("audible_notifications", models.BooleanField(default=True)),
                ("notifications", models.BooleanField(default=False)),
                (
                    "recipient",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE, to="zerver.recipient"
                    ),
                ),
                (
                    "user_profile",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE, to=settings.AUTH_USER_MODEL
                    ),
                ),
                ("pin_to_top", models.BooleanField(default=False)),
            ],
            options={
                "unique_together": {("user_profile", "recipient")},
            },
        ),
        # These indexes seem to not squash properly.
        migrations.AddIndex(
            model_name="userprofile",
            index=models.Index(
                django.db.models.functions.text.Upper("email"), name="upper_userprofile_email_idx"
            ),
        ),
        migrations.AddIndex(
            model_name="preregistrationuser",
            index=models.Index(
                django.db.models.functions.text.Upper("email"),
                name="upper_preregistration_email_idx",
            ),
        ),
        migrations.AddIndex(
            model_name="message",
            index=django.contrib.postgres.indexes.GinIndex(
                models.F("search_tsvector"), fastupdate=False, name="zerver_message_search_tsvector"
            ),
        ),
        migrations.AddIndex(
            model_name="message",
            index=models.Index(
                django.db.models.functions.text.Upper("subject"), name="upper_subject_idx"
            ),
        ),
        migrations.AddIndex(
            model_name="stream",
            index=models.Index(
                django.db.models.functions.text.Upper("name"), name="upper_stream_name_idx"
            ),
        ),
        migrations.AlterModelManagers(
            name="userprofile",
            managers=[
                ("objects", django.contrib.auth.models.UserManager()),
            ],
        ),
        migrations.AddField(
            model_name="preregistrationuser",
            name="streams",
            field=models.ManyToManyField(to="zerver.stream"),
        ),
        # AddField operations that create import cycles should happen
        # after those that can be squashed.
        migrations.AddField(
            model_name="realm",
            name="notifications_stream",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name="+",
                to="zerver.stream",
            ),
        ),
        migrations.AddField(
            model_name="userprofile",
            name="default_events_register_stream",
            field=models.ForeignKey(
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name="+",
                to="zerver.stream",
            ),
        ),
        migrations.AddField(
            model_name="userprofile",
            name="default_sending_stream",
            field=models.ForeignKey(
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name="+",
                to="zerver.stream",
            ),
        ),
        # Set up full-text search indexes.
        migrations.RunSQL(
            sql=fts_sql,
        ),
    ]
