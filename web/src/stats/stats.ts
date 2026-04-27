import $ from "jquery";
import assert from "minimalistic-assert";
import PlotlyBar from "plotly.js/lib/bar";
import Plotly from "plotly.js/lib/core";
import PlotlyPie from "plotly.js/lib/pie";
import * as tippy from "tippy.js";
import UPlot from "uplot";
import * as z from "zod/mini";

import * as blueslip from "../blueslip.ts";
import {$t, $t_html} from "../i18n.ts";

import {page_params} from "./page_params.ts";

Plotly.register([PlotlyBar, PlotlyPie]);

// Define types
type DateFormatter = (date: Date) => string;

type AggregatedData<T> = {
    dates: Date[];
    values: T;
    last_value_is_partial: boolean;
};

// Partial used here because the @types/plotly.js define the full
// set of properties while we only assign several of them.
type PlotTrace = {
    trace: Partial<Plotly.PlotData>;
};

type DataByEveryoneMe<T> = {
    everyone: T;
    me: T;
};

type DataByEveryoneUser<T> = {
    everyone: T;
    user: T;
};

type DataByUserType<T> = {
    human: T;
    bot: T;
    me: T;
};

type DataByTime<T> = {
    cumulative: T;
    year: T;
    month: T;
    week: T;
};

// Define zod schemas for plotly
const datum_schema: z.ZodMiniType<Plotly.Datum> = z.any();

// Define a schema factory function for the utility generic type
function instantiate_type_DataByEveryoneUser<T extends z.ZodMiniType>(
    schema: T,
): z.ZodMiniObject<{everyone: T; user: T}> {
    return z.object({
        everyone: schema,
        user: schema,
    });
}

// Define zod schemas for incoming data from the server
const common_data_schema = z.object({
    end_times: z.array(z.number()),
});

const active_user_data = z.object({
    _1day: z.array(datum_schema),
    _15day: z.array(datum_schema),
    all_time: z.array(datum_schema),
});

const read_data_schema = z.object({
    ...instantiate_type_DataByEveryoneUser(z.object({read: z.array(z.number())})).shape,
    ...common_data_schema.shape,
});

const sent_data_schema = z.object({
    ...instantiate_type_DataByEveryoneUser(
        z.object({
            human: z.array(z.number()),
            bot: z.array(z.number()),
        }),
    ).shape,
    ...common_data_schema.shape,
});

const ordered_sent_data_schema = z.object({
    ...instantiate_type_DataByEveryoneUser(z.record(z.string(), z.array(z.number()))).shape,
    ...common_data_schema.shape,
    display_order: z.array(z.string()),
});

const user_count_data_schema = z.object({
    ...z.object({everyone: active_user_data}).shape,
    ...common_data_schema.shape,
});

// Inferred types used in nested functions
type SentData = z.infer<typeof sent_data_schema>;
type OrderedSentData = z.infer<typeof ordered_sent_data_schema>;
type ReadData = z.infer<typeof read_data_schema>;

// Define misc zod schemas
const time_button_schema = z.enum(["cumulative", "year", "month", "week"]);
const user_button_schema = z.enum(["everyone", "user"]);

const font_14pt = {
    family: "Open Sans, sans-serif",
    size: 14,
    color: "#000000",
};

const font_12pt = {
    family: "Open Sans, sans-serif",
    size: 12,
    color: "#000000",
};

// Shared width for all charts on the stats page; matches the
// `width: 750px` rules in stats.css.
const CHART_WIDTH = 750;

let last_full_update = Number.POSITIVE_INFINITY;

function handle_parse_server_stats_result<T>(
    result: z.core.util.SafeParseResult<T>,
): T | undefined {
    if (!result.success) {
        blueslip.warn(
            "Server stats data cannot be parsed as expected.\n" +
                "Check if the schema is up-to-date or the data satisfies the schema definition.",
            {
                issues: result.error.issues,
            },
        );
        return undefined;
    }
    return result.data;
}

// Copied from attachments_ui.js
function bytes_to_size(bytes: number, kb_with_1024_bytes = false): string {
    const kb_size = kb_with_1024_bytes ? 1024 : 1000;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    if (bytes === 0) {
        return "0 B";
    }
    const i = Math.round(Math.floor(Math.log(bytes) / Math.log(kb_size)));
    let size = Math.round(bytes / Math.pow(kb_size, i));
    if (i > 0 && size < 10) {
        size = Math.round((bytes / Math.pow(kb_size, i)) * 10) / 10;
    }
    return `${size} ${sizes[i]}`;
}

// TODO: should take a dict of arrays and do it for all keys
function partial_sums(array: number[]): number[] {
    let accumulator = 0;
    return array.map((o) => {
        accumulator += o;
        return accumulator;
    });
}

// Assumes date is a round number of hours
function floor_to_local_day(date: Date): Date {
    const date_copy = new Date(date);
    date_copy.setHours(0);
    return date_copy;
}

// Assumes date is a round number of hours
function floor_to_local_week(date: Date): Date {
    const date_copy = floor_to_local_day(date);
    date_copy.setHours(-24 * date.getDay());
    return date_copy;
}

function format_date(date: Date, include_hour: boolean): string {
    const months = [
        $t({defaultMessage: "January"}),
        $t({defaultMessage: "February"}),
        $t({defaultMessage: "March"}),
        $t({defaultMessage: "April"}),
        $t({defaultMessage: "May"}),
        $t({defaultMessage: "June"}),
        $t({defaultMessage: "July"}),
        $t({defaultMessage: "August"}),
        $t({defaultMessage: "September"}),
        $t({defaultMessage: "October"}),
        $t({defaultMessage: "November"}),
        $t({defaultMessage: "December"}),
    ];
    const month_str = months[date.getMonth()];
    const year = date.getFullYear();
    const day = date.getDate();
    if (include_hour) {
        const hour = date.getHours();

        const str = hour >= 12 ? "PM" : "AM";

        return `${month_str} ${day}, ${hour % 12}:00${str}`;
    }
    return `${month_str} ${day}, ${year}`;
}

function update_last_full_update(end_times: number[]): void {
    if (end_times.length === 0) {
        return;
    }

    last_full_update = Math.min(last_full_update, end_times.at(-1)!);
    const update_time = new Date(last_full_update * 1000);
    const locale_date = update_time.toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
    });
    const locale_time = update_time.toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "numeric",
    });

    $("#id_last_full_update").text(locale_time + " on " + locale_date);
    $("#id_last_full_update").closest(".last-update").show();
}

$(() => {
    tippy.default(".last_update_tooltip", {
        // Same defaults as set in our tippyjs module.
        maxWidth: 300,
        delay: [100, 20],
        animation: false,
        touch: ["hold", 750],
        placement: "top",
    });
    // Add configuration for any additional tooltips here.
});

// Helper used in vertical bar charts
function make_rangeselector(
    button1: Partial<Plotly.RangeSelectorButton>,
    button2: Partial<Plotly.RangeSelectorButton>,
): Partial<Plotly.RangeSelector> {
    return {
        x: -0.045,
        y: -0.62,
        buttons: [
            {stepmode: "backward", ...button1},
            {stepmode: "backward", ...button2},
            {step: "all", label: $t({defaultMessage: "All time"})},
        ],
    };
}

type ActiveUserData = {
    _1day: Plotly.Datum[];
    _15day: Plotly.Datum[];
    all_time: Plotly.Datum[];
};

// SUMMARY STATISTICS
function get_user_summary_statistics(data: ActiveUserData): void {
    if (Object.keys(data).length === 0) {
        return;
    }

    // Users that are not deactivated and are not bots.
    const total_users = data.all_time.at(-1)!;
    const total_users_string = total_users.toLocaleString();

    $("#id_total_users").text(total_users_string);
    $("#id_total_users").closest("summary-stats").show();

    // Users that have been active in the last 15 days and are not bots.
    const active_fifeteen_day_users = data._15day.at(-1)!;
    const active_fifteen_day_users_string = active_fifeteen_day_users.toLocaleString();

    $("#id_active_fifteen_day_users").text(active_fifteen_day_users_string);
    $("#id_active_fifteen_day_users").closest("summary-stats").show();
}

function get_total_messages_sent(data: DataByUserType<number[]>): void {
    if (Object.keys(data).length === 0) {
        return;
    }

    const total_messages_sent = data.human.at(-1)! + data.bot.at(-1)!;
    const total_messages_string = total_messages_sent.toLocaleString();

    $("#id_total_messages_sent").text(total_messages_string);
    $("#id_total_messages_sent").closest("summary-stats").show();
}

function get_thirty_days_messages_sent(data: DataByUserType<number[]>): void {
    if (Object.keys(data).length === 0) {
        return;
    }

    const thirty_days_bot_messages = data.bot
        .slice(-30)
        .reduce((total_messages, day_messages) => total_messages + day_messages);
    const thirty_days_human_messages = data.human
        .slice(-30)
        .reduce((total_messages, day_messages) => total_messages + day_messages);

    const thirty_days_total_messages = thirty_days_bot_messages + thirty_days_human_messages;
    const thirty_days_messages_string = thirty_days_total_messages.toLocaleString();

    $("#id_thirty_days_messages_sent").text(thirty_days_messages_string);
    $("#id_thirty_days_messages_sent").closest("summary-stats").show();
}

function set_storage_space_used_statistic(upload_space_used: number | null): void {
    let space_used = "N/A";
    if (upload_space_used !== null) {
        space_used = bytes_to_size(upload_space_used, true);
    }

    $("#id_storage_space_used").text(space_used);
    $("#id_storage_space_used").closest("summary-stats").show();
}

function set_guest_users_statistic(guest_users: number | null): void {
    let guest_users_string = "N/A";
    if (guest_users !== null) {
        guest_users_string = guest_users.toLocaleString();
    }

    $("#id_guest_users_count").text(guest_users_string);
    $("#id_guest_users_count").closest("summary-stats").show();
}

// PLOTLY CHARTS
function populate_messages_sent_over_time(raw_data: unknown): void {
    // Content rendered by this method is titled as "Messages sent over time" on the webpage
    const result = sent_data_schema.safeParse(raw_data);
    const data = handle_parse_server_stats_result(result);
    if (data === undefined) {
        return;
    }

    if (data.end_times.length === 0) {
        // TODO: do something nicer here
        return;
    }

    // Helper functions
    function make_traces(
        dates: Date[],
        values: DataByUserType<number[]>,
        type: Plotly.PlotType,
        date_formatter: DateFormatter,
    ): DataByUserType<Partial<Plotly.PlotData>> {
        const text = dates.map((date) => date_formatter(date));
        const common: Partial<Plotly.PlotData> = {
            x: dates,
            type,
            hoverinfo: "none",
            text,
            textposition: "none",
        };
        return {
            human: {
                // 5062a0
                name: $t({defaultMessage: "Humans"}),
                y: values.human,
                marker: {color: "#5f6ea0"},
                ...common,
            },
            bot: {
                // a09b5f bbb56e
                name: $t({defaultMessage: "Bots"}),
                y: values.bot,
                marker: {color: "#b7b867"},
                ...common,
            },
            me: {
                name: $t({defaultMessage: "Me"}),
                y: values.me,
                marker: {color: "#be6d68"},
                ...common,
            },
        };
    }

    const layout: Partial<Plotly.Layout> = {
        barmode: "group",
        width: CHART_WIDTH,
        height: 400,
        margin: {l: 40, r: 10, b: 40, t: 0},
        xaxis: {
            fixedrange: true,
            rangeslider: {bordercolor: "#D8D8D8", borderwidth: 1},
            type: "date",
            tickangle: 0,
        },
        yaxis: {fixedrange: true, rangemode: "tozero"},
        legend: {
            x: 0.62,
            y: 1.12,
            orientation: "h",
            font: font_14pt,
        },
        font: font_12pt,
    };

    // This is also the cumulative rangeselector
    const daily_rangeselector = make_rangeselector(
        {count: 10, label: $t({defaultMessage: "Last 10 days"}), step: "day"},
        {count: 30, label: $t({defaultMessage: "Last 30 days"}), step: "day"},
    );
    const weekly_rangeselector = make_rangeselector(
        {count: 2, label: $t({defaultMessage: "Last 2 months"}), step: "month"},
        {count: 6, label: $t({defaultMessage: "Last 6 months"}), step: "month"},
    );

    function add_hover_handler(): void {
        document
            .querySelector<Plotly.PlotlyHTMLElement>("#id_messages_sent_over_time")!
            .on("plotly_hover", (data) => {
                $("#hoverinfo").show();
                document.querySelector("#hover_date")!.textContent =
                    data.points[0]!.data.text[data.points[0]!.pointNumber]!;
                const values: Plotly.Datum[] = [null, null, null];
                for (const trace of data.points) {
                    values[trace.curveNumber] = trace.y;
                }
                const hover_text_ids = ["#hover_me", "#hover_human", "#hover_bot"];
                const hover_value_ids = [
                    "#hover_me_value",
                    "#hover_human_value",
                    "#hover_bot_value",
                ];
                for (const [i, value] of values.entries()) {
                    if (value !== null) {
                        document.querySelector<HTMLElement>(hover_text_ids[i]!)!.style.display =
                            "inline";
                        document.querySelector<HTMLElement>(hover_value_ids[i]!)!.style.display =
                            "inline";
                        document.querySelector<HTMLElement>(hover_value_ids[i]!)!.textContent =
                            value.toString();
                    } else {
                        document.querySelector<HTMLElement>(hover_text_ids[i]!)!.style.display =
                            "none";
                        document.querySelector<HTMLElement>(hover_value_ids[i]!)!.style.display =
                            "none";
                    }
                }
            });
    }

    const start_dates = data.end_times.map(
        (timestamp: number) =>
            // data.end_times are the ends of hour long intervals.
            new Date(timestamp * 1000 - 60 * 60 * 1000),
    );

    function aggregate_data(
        data: SentData,
        aggregation: "day" | "week",
    ): AggregatedData<DataByUserType<number[]>> {
        let start;
        let is_boundary;
        if (aggregation === "day") {
            start = floor_to_local_day(start_dates[0]!);
            is_boundary = function (date: Date) {
                return date.getHours() === 0;
            };
        } else {
            assert(aggregation === "week");
            start = floor_to_local_week(start_dates[0]!);
            is_boundary = function (date: Date) {
                return date.getHours() === 0 && date.getDay() === 0;
            };
        }
        const dates = [start];
        const values: DataByUserType<number[]> = {human: [], bot: [], me: []};
        let current: DataByUserType<number> = {human: 0, bot: 0, me: 0};
        let i_init = 0;
        if (is_boundary(start_dates[0]!)) {
            current = {
                human: data.everyone.human[0]!,
                bot: data.everyone.bot[0]!,
                me: data.user.human[0]!,
            };
            i_init = 1;
        }
        for (let i = i_init; i < start_dates.length; i += 1) {
            if (is_boundary(start_dates[i]!)) {
                dates.push(start_dates[i]!);
                values.human.push(current.human);
                values.bot.push(current.bot);
                values.me.push(current.me);
                current = {human: 0, bot: 0, me: 0};
            }
            current.human += data.everyone.human[i]!;
            current.bot += data.everyone.bot[i]!;
            current.me += data.user.human[i]!;
        }
        values.human.push(current.human);
        values.bot.push(current.bot);
        values.me.push(current.me);
        return {
            dates,
            values,
            last_value_is_partial: !is_boundary(
                new Date(start_dates.at(-1)!.getTime() + 60 * 60 * 1000),
            ),
        };
    }

    // Generate traces
    let date_formatter = function (date: Date): string {
        return format_date(date, true);
    };
    let values = {me: data.user.human, human: data.everyone.human, bot: data.everyone.bot};

    let info = aggregate_data(data, "day");
    date_formatter = function (date) {
        return format_date(date, false);
    };
    const last_day_is_partial = info.last_value_is_partial;
    const daily_traces = make_traces(info.dates, info.values, "bar", date_formatter);
    get_thirty_days_messages_sent(info.values);

    info = aggregate_data(data, "week");
    date_formatter = function (date) {
        return $t({defaultMessage: "Week of {date}"}, {date: format_date(date, false)});
    };
    const last_week_is_partial = info.last_value_is_partial;
    const weekly_traces = make_traces(info.dates, info.values, "bar", date_formatter);

    const dates = data.end_times.map((timestamp: number) => new Date(timestamp * 1000));
    values = {
        human: partial_sums(data.everyone.human),
        bot: partial_sums(data.everyone.bot),
        me: partial_sums(data.user.human),
    };
    date_formatter = function (date) {
        return format_date(date, true);
    };
    get_total_messages_sent(values);
    const cumulative_traces = make_traces(dates, values, "scatter", date_formatter);

    // Functions to draw and interact with the plot

    // We need to redraw plot entirely if switching from (the cumulative) line
    // graph to any bar graph, since otherwise the rangeselector shows both (plotly bug)
    let clicked_cumulative = false;

    function draw_or_update_plot(
        rangeselector: Partial<Plotly.RangeSelector>,
        traces: DataByUserType<Partial<Plotly.PlotData>>,
        last_value_is_partial: boolean,
        initial_draw: boolean,
    ): void {
        $("#daily_button, #weekly_button, #cumulative_button").removeClass("selected");
        $("#id_messages_sent_over_time > div").removeClass("spinner");
        if (initial_draw) {
            traces.human.visible = true;
            traces.bot.visible = "legendonly";
            traces.me.visible = "legendonly";
        } else {
            const plotDiv = document.querySelector<Plotly.PlotlyHTMLElement>(
                "#id_messages_sent_over_time",
            )!;
            assert("visible" in plotDiv.data[0]!);
            assert("visible" in plotDiv.data[1]!);
            assert("visible" in plotDiv.data[2]!);
            traces.me.visible = plotDiv.data[0].visible;
            traces.human.visible = plotDiv.data[1].visible;
            traces.bot.visible = plotDiv.data[2].visible;
        }
        layout.xaxis!.rangeselector = rangeselector;
        if (clicked_cumulative || initial_draw) {
            void Plotly.newPlot(
                "id_messages_sent_over_time",
                [traces.me, traces.human, traces.bot],
                layout,
                {displayModeBar: false},
            );
            add_hover_handler();
        } else {
            void Plotly.deleteTraces("id_messages_sent_over_time", [0, 1, 2]);
            void Plotly.addTraces("id_messages_sent_over_time", [
                traces.me,
                traces.human,
                traces.bot,
            ]);
            void Plotly.relayout("id_messages_sent_over_time", layout);
        }
        $("#id_messages_sent_over_time").attr(
            "last_value_is_partial",
            last_value_is_partial.toString(),
        );
    }

    // Click handlers for aggregation buttons
    $("#daily_button").on("click", function () {
        draw_or_update_plot(daily_rangeselector, daily_traces, last_day_is_partial, false);
        $(this).addClass("selected");
        clicked_cumulative = false;
    });

    $("#weekly_button").on("click", function () {
        draw_or_update_plot(weekly_rangeselector, weekly_traces, last_week_is_partial, false);
        $(this).addClass("selected");
        clicked_cumulative = false;
    });

    $("#cumulative_button").on("click", function () {
        clicked_cumulative = false;
        draw_or_update_plot(daily_rangeselector, cumulative_traces, false, false);
        $(this).addClass("selected");
        clicked_cumulative = true;
    });

    // Initial drawing of plot
    if (weekly_traces.human.x!.length < 12) {
        draw_or_update_plot(daily_rangeselector, daily_traces, last_day_is_partial, true);
        $("#daily_button").addClass("selected");
    } else {
        draw_or_update_plot(weekly_rangeselector, weekly_traces, last_week_is_partial, true);
        $("#weekly_button").addClass("selected");
    }
}

function round_to_percentages(values: number[], total: number): string[] {
    return values.map((x) => {
        if (x === total) {
            return "100%";
        }
        if (x === 0) {
            return "0%";
        }
        const unrounded = (x / total) * 100;

        const precision = Math.min(
            6, // this is the max precision (two #, 4 decimal points; 99.9999%).
            Math.max(
                2, // the minimum amount of precision (40% or 6.0%).
                Math.floor(-Math.log10(100 - unrounded)) + 3,
            ),
        );

        return unrounded.toPrecision(precision) + "%";
    });
}

// Last label will turn into "Other" if time_series data has a label not in labels
function compute_summary_chart_data(
    time_series_data: Record<string, number[]>,
    num_steps: number,
    labels_: string[],
): {
    values: number[];
    labels: string[];
    percentages: string[];
    total: number;
} {
    const data = new Map<string, number>();
    for (const [key, array] of Object.entries(time_series_data)) {
        if (array.length < num_steps) {
            num_steps = array.length;
        }
        let sum = 0;
        for (let i = 1; i <= num_steps; i += 1) {
            sum += array.at(-i)!;
        }
        data.set(key, sum);
    }
    const labels = [...labels_];
    const values: number[] = [];
    for (const label of labels) {
        if (data.has(label)) {
            values.push(data.get(label)!);
            data.delete(label);
        } else {
            values.push(0);
        }
    }
    if (data.size > 0) {
        labels[labels.length - 1] = "Other";
        for (const sum of data.values()) {
            values[labels.length - 1]! += sum;
        }
    }
    let total = 0;
    for (const value of values) {
        total += value;
    }
    return {
        values,
        labels,
        percentages: round_to_percentages(values, total),
        total,
    };
}

function populate_messages_sent_by_client(raw_data: unknown): void {
    // Content rendered by this method is titled as "Messages sent by client" on the webpage
    const result = ordered_sent_data_schema.safeParse(raw_data);
    const data = handle_parse_server_stats_result(result);
    if (data === undefined) {
        return;
    }

    type PlotDataByMessageClient = PlotTrace & {
        trace: {
            x: number[];
        };
        trace_annotations: Partial<Plotly.PlotData>;
    };

    const layout: Partial<Plotly.Layout> = {
        width: CHART_WIDTH,
        // height set in draw_plot()
        margin: {l: 10, r: 10, b: 40, t: 10},
        font: font_14pt,
        // xaxis set in draw_plot()
        yaxis: {showticklabels: false},
        showlegend: false,
    };

    // sort labels so that values are descending in the default view
    const everyone_month = compute_summary_chart_data(
        data.everyone,
        30,
        data.display_order.slice(0, 12),
    );
    const label_values: {label: string; value: number}[] = [];
    for (let i = 0; i < everyone_month.values.length; i += 1) {
        label_values.push({
            label: everyone_month.labels[i]!,
            value: everyone_month.labels[i] === "Other" ? -1 : everyone_month.values[i]!,
        });
    }
    label_values.sort((a, b) => b.value - a.value);
    const labels: string[] = [];
    for (const item of label_values) {
        labels.push(item.label);
    }

    function make_plot_data(
        time_series_data: Record<string, number[]>,
        num_steps: number,
    ): PlotDataByMessageClient {
        const plot_data = compute_summary_chart_data(time_series_data, num_steps, labels);
        plot_data.values.reverse();
        plot_data.labels.reverse();
        plot_data.percentages.reverse();
        const annotations: {values: number[]; labels: string[]; text: string[]} = {
            values: [],
            labels: [],
            text: [],
        };
        for (let i = 0; i < plot_data.values.length; i += 1) {
            if (plot_data.values[i]! > 0) {
                annotations.values.push(plot_data.values[i]!);
                annotations.labels.push(plot_data.labels[i]!);
                annotations.text.push(
                    "   " + plot_data.labels[i] + " (" + plot_data.percentages[i] + ")",
                );
            }
        }
        return {
            trace: {
                x: plot_data.values,
                y: plot_data.labels,
                type: "bar",
                orientation: "h",
                textinfo: "text",
                hoverinfo: "none",
                marker: {color: "#537c5e"},
            },
            trace_annotations: {
                x: annotations.values,
                y: annotations.labels,
                mode: "text",
                type: "scatter",
                textposition: "middle right",
                text: annotations.text,
            },
        };
    }

    const plot_data: DataByEveryoneUser<DataByTime<PlotDataByMessageClient>> = {
        everyone: {
            cumulative: make_plot_data(data.everyone, data.end_times.length),
            year: make_plot_data(data.everyone, 365),
            month: make_plot_data(data.everyone, 30),
            week: make_plot_data(data.everyone, 7),
        },
        user: {
            cumulative: make_plot_data(data.user, data.end_times.length),
            year: make_plot_data(data.user, 365),
            month: make_plot_data(data.user, 30),
            week: make_plot_data(data.user, 7),
        },
    };

    let user_button: "everyone" | "user" = "everyone";
    let time_button: "cumulative" | "year" | "month" | "week";
    if (data.end_times.length >= 30) {
        time_button = "month";
        $("#messages_by_client_last_month_button").addClass("selected");
    } else {
        time_button = "cumulative";
        $("#messages_by_client_cumulative_button").addClass("selected");
    }

    if (data.end_times.length < 365) {
        $("#messages_sent_by_client button[data-time='year']").remove();
        if (data.end_times.length < 30) {
            $("#messages_sent_by_client button[data-time='month']").remove();
            if (data.end_times.length < 7) {
                $("#messages_sent_by_client button[data-time='week']").remove();
            }
        }
    }

    function draw_plot(): void {
        $("#messages_sent_by_client_chart > div").removeClass("spinner");
        const data_ = plot_data[user_button][time_button];
        layout.height = layout.margin!.b! + data_.trace.x.length * 30;
        layout.xaxis = {range: [0, Math.max(...data_.trace.x) * 1.3]};
        void Plotly.newPlot(
            "messages_sent_by_client_chart",
            [data_.trace, data_.trace_annotations],
            layout,
            {displayModeBar: false, staticPlot: true},
        );
    }

    draw_plot();

    // Click handlers
    function set_user_button($button: JQuery): void {
        $("#messages_sent_by_client button[data-user]").removeClass("selected");
        $button.addClass("selected");
    }

    function set_time_button($button: JQuery): void {
        $("#messages_sent_by_client button[data-time]").removeClass("selected");
        $button.addClass("selected");
    }

    $("#messages_sent_by_client button").on("click", function () {
        if ($(this).attr("data-user")) {
            set_user_button($(this));
            user_button = user_button_schema.parse($(this).attr("data-user"));
            // Now `user_button` will be of type "everyone" | "user"
        }
        if ($(this).attr("data-time")) {
            set_time_button($(this));
            time_button = time_button_schema.parse($(this).attr("data-time"));
            // Now `time_button` will be of type "cumulative" | "year" | "month" | "week"
        }
        draw_plot();
    });
}

function populate_messages_sent_by_message_type(raw_data: unknown): void {
    // Content rendered by this method is titled as "Messages sent by recipient type" on the webpage
    const result = ordered_sent_data_schema.safeParse(raw_data);
    const data = handle_parse_server_stats_result(result);
    if (data === undefined) {
        return;
    }

    type PlotDataByMessageType = {
        trace: Partial<Plotly.PieData>;
        total_html: string;
    };

    const layout = {
        margin: {l: 90, r: 0, b: 10, t: 0},
        width: CHART_WIDTH,
        height: 300,
        legend: {
            font: font_14pt,
        },
        font: font_12pt,
    };

    function make_plot_data(
        data: OrderedSentData,
        time_series_data: Record<string, number[]>,
        num_steps: number,
    ): PlotDataByMessageType {
        const plot_data = compute_summary_chart_data(
            time_series_data,
            num_steps,
            data.display_order,
        );
        const labels: string[] = [];
        for (let i = 0; i < plot_data.labels.length; i += 1) {
            labels.push(plot_data.labels[i] + " (" + plot_data.percentages[i] + ")");
        }
        const total_string = plot_data.total.toLocaleString();
        return {
            trace: {
                values: plot_data.values,
                labels,
                type: "pie",
                direction: "clockwise",
                rotation: -90,
                sort: false,
                textinfo: "text",
                text: plot_data.labels.map(() => ""),
                hoverinfo: "label+value",
                pull: 0.05,
                marker: {
                    colors: ["#68537c", "#be6d68", "#b3b348"],
                },
            },
            total_html: $t_html(
                {defaultMessage: "<b>Total messages</b>: {total_messages}"},
                {total_messages: total_string},
            ),
        };
    }

    const plot_data: DataByEveryoneUser<DataByTime<PlotDataByMessageType>> = {
        everyone: {
            cumulative: make_plot_data(data, data.everyone, data.end_times.length),
            year: make_plot_data(data, data.everyone, 365),
            month: make_plot_data(data, data.everyone, 30),
            week: make_plot_data(data, data.everyone, 7),
        },
        user: {
            cumulative: make_plot_data(data, data.user, data.end_times.length),
            year: make_plot_data(data, data.user, 365),
            month: make_plot_data(data, data.user, 30),
            week: make_plot_data(data, data.user, 7),
        },
    };

    let user_button: "everyone" | "user" = "everyone";
    let time_button: "cumulative" | "year" | "month" | "week";
    if (data.end_times.length >= 30) {
        time_button = "month";
        $("#messages_by_type_last_month_button").addClass("selected");
    } else {
        time_button = "cumulative";
        $("#messages_by_type_cumulative_button").addClass("selected");
    }
    const totaldiv = document.querySelector("#pie_messages_sent_by_type_total")!;

    if (data.end_times.length < 365) {
        $("#pie_messages_sent_by_type button[data-time='year']").remove();
        if (data.end_times.length < 30) {
            $("#pie_messages_sent_by_type button[data-time='month']").remove();
            if (data.end_times.length < 7) {
                $("#pie_messages_sent_by_type button[data-time='week']").remove();
            }
        }
    }

    function draw_plot(): void {
        $("#id_messages_sent_by_message_type > div").removeClass("spinner");
        void Plotly.newPlot(
            "id_messages_sent_by_message_type",
            [plot_data[user_button][time_button].trace],
            layout,
            {displayModeBar: false},
        );
        totaldiv.innerHTML = plot_data[user_button][time_button].total_html;
    }

    draw_plot();

    // Click handlers
    function set_user_button($button: JQuery): void {
        $("#pie_messages_sent_by_type button[data-user]").removeClass("selected");
        $button.addClass("selected");
    }

    function set_time_button($button: JQuery): void {
        $("#pie_messages_sent_by_type button[data-time]").removeClass("selected");
        $button.addClass("selected");
    }

    $("#pie_messages_sent_by_type button").on("click", function () {
        if ($(this).attr("data-user")) {
            set_user_button($(this));
            user_button = user_button_schema.parse($(this).attr("data-user"));
            // Now `user_button` will be of type "everyone" | "user"
        }
        if ($(this).attr("data-time")) {
            set_time_button($(this));
            time_button = time_button_schema.parse($(this).attr("data-time"));
            // Now `time_button` will be of type "cumulative" | "year" | "month" | "week"
        }
        draw_plot();
    });
}

// `null` preset means "all time" (full data range); otherwise the
// preset specifies how far back from data_max the start should be.
type XRangePreset = {months: number} | {days: number} | null;

function apply_x_range_preset(
    u: UPlot,
    data_min: number,
    data_max: number,
    preset: XRangePreset,
): void {
    if (preset === null) {
        u.setScale("x", {min: data_min, max: data_max});
        return;
    }
    const min_date = new Date(data_max * 1000);
    if ("months" in preset) {
        min_date.setMonth(min_date.getMonth() - preset.months);
    } else {
        min_date.setDate(min_date.getDate() - preset.days);
    }
    // Clamp to data_min so the range never extends before the first data point.
    u.setScale("x", {
        min: Math.max(data_min, min_date.getTime() / 1000),
        max: data_max,
    });
}

// Returns a uPlot path builder that draws bars for one series within
// a group of `num_series` series, with bars centered on each x value
// and the group filling `factor` of the inter-x spacing.
function make_grouped_bars_paths(
    series_idx: number,
    num_series: number,
    factor: number,
): UPlot.Series.PathBuilder {
    function bar_width(u: UPlot): number {
        const xs = u.data[0];
        const x_step = xs.length > 1 ? Number(xs[1]) - Number(xs[0]) : 0;
        return (x_step * factor) / num_series;
    }
    return UPlot.paths.bars!({
        size: [1, 100],
        align: 0,
        disp: {
            x0: {
                unit: 1,
                values(u) {
                    const xs = u.data[0];
                    const w = bar_width(u);
                    const offset = (series_idx - (num_series - 1) / 2) * w;
                    return Array.from(xs, (x) => x + offset - w / 2);
                },
            },
            size: {
                unit: 1,
                values(u) {
                    const xs = u.data[0];
                    const w = bar_width(u);
                    return Array.from(xs, () => w);
                },
            },
        },
    });
}

// drawSeries hook that fades the last visible bar of each shown
// series, used to indicate that the most recent bucket is still
// accumulating data. Must use the same num_series and factor as the
// matching make_grouped_bars_paths.
function make_fade_last_bar_hook(
    num_series: number,
    factor: number,
): (u: UPlot, sidx: number) => void {
    return (u, sidx) => {
        if (sidx === 0 || u.series[sidx]?.show !== true) {
            return;
        }
        const xs = u.data[0];
        const ys = u.data[sidx]!;
        if (xs.length === 0) {
            return;
        }
        const last_idx = xs.length - 1;
        const last_x = Number(xs[last_idx]);
        const last_y: number | null | undefined = ys[last_idx];
        if (last_y === null || last_y === undefined) {
            return;
        }
        const x_min = u.scales["x"]?.min;
        const x_max = u.scales["x"]?.max;
        if (x_min === undefined || x_max === undefined) {
            return;
        }
        if (last_x < x_min || last_x > x_max) {
            return;
        }
        const x_step = xs.length > 1 ? Number(xs[1]) - Number(xs[0]) : 0;
        const w = (x_step * factor) / num_series;
        // Series start at sidx=1; sidx-1 is the index within the bar group.
        const offset = (sidx - 1 - (num_series - 1) / 2) * w;
        const x_left = u.valToPos(last_x + offset - w / 2, "x", true);
        const x_right = u.valToPos(last_x + offset + w / 2, "x", true);
        const y_zero = u.valToPos(0, "y", true);
        const y_top = u.valToPos(last_y, "y", true);
        const ctx = u.ctx;
        ctx.save();
        // destination-out with semi-transparent black removes alpha from
        // the already-drawn bar, halving its opacity.
        ctx.globalCompositeOperation = "destination-out";
        ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
        ctx.fillRect(x_left, y_top, x_right - x_left, y_zero - y_top);
        ctx.restore();
    };
}

type Ranger = {
    set_range: (min: number, max: number) => void;
    update_data: (new_data: UPlot.AlignedData) => void;
    destroy: () => void;
};

type RangerSeriesConfig = {stroke: string; fill: string};

function make_ranger(
    ranger_container: HTMLElement,
    initial_data: UPlot.AlignedData,
    initial_data_min: number,
    initial_data_max: number,
    width: number,
    series_configs: RangerSeriesConfig[],
    on_range_change: (range_min: number, range_max: number) => void,
): Ranger {
    // Mutable so that update_data can reflect a new x range when the
    // caller swaps the underlying dataset (e.g. switching aggregation
    // mode in the messages-read chart).
    let data_min = initial_data_min;
    let data_max = initial_data_max;

    const overlay = ranger_container.querySelector<HTMLElement>(".ranger-overlay")!;
    const masks = [...overlay.querySelectorAll<HTMLElement>(".ranger-mask")];
    const grips = [...overlay.querySelectorAll<HTMLElement>(".ranger-grip")];
    const [mask_left, mask_right] = masks;
    const [grip_left, grip_right] = grips;
    const selected = overlay.querySelector<HTMLElement>(".ranger-selected")!;

    const overview = new UPlot(
        {
            width,
            height: 55,
            cursor: {show: false},
            legend: {show: false},
            series: [
                {},
                ...series_configs.map((config) => ({
                    stroke: config.stroke,
                    fill: config.fill,
                    width: 1,
                    points: {show: false},
                })),
            ],
            axes: [{show: false}, {show: false}],
            scales: {
                x: {time: true},
                y: {range: (_u, _min, max) => [0, max <= 0 ? 1 : max]},
            },
            padding: [4, 0, 4, 0],
            hooks: {
                // update_overlay reads overview.bbox, which is only populated
                // after the first draw.  uPlot draws via queueMicrotask, so
                // bbox.width is still 0 right after the constructor returns.
                // The ready hook fires once the initial paint is complete.
                ready: [update_overlay],
            },
        },
        initial_data,
        ranger_container,
    );

    // uPlot appends its root after the overlay; move it before so the overlay
    // sits on top without needing an explicit z-index contest.
    ranger_container.insertBefore(overview.root, overlay);

    let sel_min = data_min;
    let sel_max = data_max;

    // The overlay maps the selection range to canvas pixels directly
    // from data_min/data_max rather than via overview.valToPos, which
    // can return offset positions when uPlot expands the x scale to
    // nice-tick boundaries on dataset switches.
    function update_overlay(): void {
        // Half-width of each grip handle in CSS pixels (full grip is 8 px wide,
        // matching the .ranger-grip width in stats.css).
        const GRIP_HALF_WIDTH = 4;
        if (overview.bbox.width === 0) {
            return;
        }
        const bbox_left_css = overview.bbox.left / UPlot.pxRatio;
        const bbox_width_css = overview.bbox.width / UPlot.pxRatio;
        const bbox_right_css = bbox_left_css + bbox_width_css;
        function val_to_x(val: number): number {
            return bbox_left_css + ((val - data_min) / (data_max - data_min)) * bbox_width_css;
        }
        const min_x = val_to_x(sel_min);
        const max_x = val_to_x(sel_max);

        mask_left!.style.left = `${bbox_left_css}px`;
        mask_left!.style.width = `${Math.max(0, min_x - GRIP_HALF_WIDTH - bbox_left_css)}px`;

        grip_left!.style.left = `${min_x - GRIP_HALF_WIDTH}px`;

        selected.style.left = `${min_x + GRIP_HALF_WIDTH}px`;
        selected.style.width = `${Math.max(0, max_x - GRIP_HALF_WIDTH - (min_x + GRIP_HALF_WIDTH))}px`;

        grip_right!.style.left = `${max_x - GRIP_HALF_WIDTH}px`;

        mask_right!.style.left = `${max_x + GRIP_HALF_WIDTH}px`;
        mask_right!.style.width = `${Math.max(0, bbox_right_css - (max_x + GRIP_HALF_WIDTH))}px`;
    }

    function val_per_px(): number {
        return (data_max - data_min) / (overview.bbox.width / UPlot.pxRatio);
    }

    // Attach pointer-capture drag to a grip or the selected region.
    // on_drag receives the data-value delta and the sel_min/sel_max frozen at
    // drag start, so the new boundary is computed from a fixed origin rather
    // than accumulating floating-point error across move events.
    function attach_drag(
        grip: HTMLElement,
        on_drag: (val_delta: number, start_min: number, start_max: number) => void,
    ): void {
        let start_x = 0;
        let start_min = 0;
        let start_max = 0;
        grip.addEventListener("pointerdown", (e) => {
            start_x = e.clientX;
            start_min = sel_min;
            start_max = sel_max;
            grip.setPointerCapture(e.pointerId);
            e.preventDefault();
        });
        grip.addEventListener("pointermove", (e) => {
            if (!grip.hasPointerCapture(e.pointerId)) {
                return;
            }
            const val_delta = (e.clientX - start_x) * val_per_px();
            on_drag(val_delta, start_min, start_max);
            update_overlay();
            on_range_change(sel_min, sel_max);
        });
    }

    // For large datasets, use 2% of the total range so the minimum
    // window grows proportionally rather than staying fixed at one
    // week.  Computed lazily because data_min/data_max can change via
    // update_data.
    const ONE_WEEK_SECS = 86_400 * 7;
    function min_range(): number {
        return Math.max((data_max - data_min) * 0.02, ONE_WEEK_SECS);
    }

    attach_drag(grip_left!, (val_delta, start_min) => {
        sel_min = Math.max(data_min, Math.min(start_min + val_delta, sel_max - min_range()));
    });
    attach_drag(grip_right!, (val_delta, _start_min, start_max) => {
        sel_max = Math.min(data_max, Math.max(start_max + val_delta, sel_min + min_range()));
    });
    attach_drag(selected, (val_delta, start_min, start_max) => {
        const window_size = start_max - start_min;
        sel_min = Math.max(data_min, start_min + val_delta);
        sel_max = sel_min + window_size;
        if (sel_max > data_max) {
            sel_max = data_max;
            sel_min = data_max - window_size;
        }
    });

    return {
        set_range(min: number, max: number): void {
            sel_min = min;
            sel_max = max;
            update_overlay();
        },
        update_data(new_data: UPlot.AlignedData): void {
            const xs = new_data[0];
            if (xs !== undefined && xs.length > 0) {
                data_min = xs[0]!;
                data_max = xs.at(-1)!;
                sel_min = data_min;
                sel_max = data_max;
            }
            // Pass resetScales=false so uPlot doesn't auto-expand the x
            // scale to a nice-tick boundary (which makes valToPos return
            // an offset position for xs[0] / xs[-1]).
            overview.setData(new_data, false);
            overview.setScale("x", {min: data_min, max: data_max});
            update_overlay();
        },
        destroy(): void {
            overview.destroy();
        },
    };
}

function populate_number_of_users(raw_data: unknown): void {
    // Content rendered by this method is titled as "Active users" on the webpage
    const result = user_count_data_schema.safeParse(raw_data);
    const data = handle_parse_server_stats_result(result);
    if (data === undefined) {
        return;
    }

    const end_times = data.end_times; // Unix timestamps in seconds
    const data_min = end_times[0] ?? 0;
    const data_max = end_times.at(-1) ?? 0;
    const container = document.querySelector<HTMLElement>("#id_number_of_users")!;
    const ranger_container = document.querySelector<HTMLElement>("#id_number_of_users_ranger")!;
    const series_stroke = "rgb(91, 137, 181)";
    const series_fill = "rgba(91, 137, 181, 0.15)";
    const series_fill_bar = "rgba(91, 137, 181, 0.2)";

    let uplot_instance: UPlot | null = null;
    let ranger: Ranger | null = null;
    let range_preset_pending = false;

    function make_opts(is_bar: boolean, series_label: string): UPlot.Options {
        return {
            width: CHART_WIDTH,
            height: 330,
            scales: {
                x: {time: true},
                y: {
                    range: (_u, _data_min, max) => [0, max !== null && max > 0 ? max : 1],
                },
            },
            series: [
                {
                    label: $t({defaultMessage: "Date"}),
                    value: (_u, v) =>
                        Number.isFinite(v) ? format_date(new Date(v * 1000), false) : "—",
                },
                {
                    label: series_label,
                    stroke: series_stroke,
                    ...(is_bar
                        ? {
                              fill: series_fill_bar,
                              paths: UPlot.paths.bars!({size: [0.6, 100]}),
                          }
                        : {}),
                    width: 2,
                    points: {show: false},
                },
            ],
            cursor: {
                y: false,
                drag: {setScale: true, x: true, y: false},
            },
        };
    }

    function to_uplot_data(values: Plotly.Datum[]): UPlot.AlignedData {
        return [new Float64Array(end_times), new Float64Array(values.map(Number))];
    }
    const _1day_data = to_uplot_data(data.everyone._1day);
    const _15day_data = to_uplot_data(data.everyone._15day);
    const all_time_data = to_uplot_data(data.everyone.all_time);

    function select_data_set_button($button: JQuery): void {
        $("#daily_active_users, #15day_active_users, #all_time_active_users").removeClass(
            "selected",
        );
        $button.addClass("selected");
    }

    function select_preset_range_button($button: JQuery): void {
        $("#users_2month_range, #users_6month_range, #users_all_time_range").removeClass(
            "selected",
        );
        $button.addClass("selected");
    }

    function apply_preset_range($button: JQuery, preset: XRangePreset): void {
        if (uplot_instance === null) {
            return;
        }
        range_preset_pending = true;
        apply_x_range_preset(uplot_instance, data_min, data_max, preset);
        select_preset_range_button($button);
    }

    function draw_plot(is_bar: boolean, series_label: string, uplot_data: UPlot.AlignedData): void {
        if (uplot_instance === null) {
            // First draw: clear the loading spinner.
            $("#id_number_of_users > div").removeClass("spinner");
        } else {
            uplot_instance.destroy();
        }
        uplot_instance = new UPlot(make_opts(is_bar, series_label), uplot_data, container);

        // Deselect preset range buttons and sync the ranger whenever the x scale
        // changes (drag-to-zoom on the main chart or ranger grip drag). The hook
        // fires asynchronously via uPlot's microtask queue, so range_preset_pending
        // is used to avoid removing the "selected" class that a button click handler
        // just added synchronously.
        (uplot_instance.hooks.setScale ??= []).push((_u, scaleKey) => {
            if (scaleKey !== "x") {
                return;
            }
            if (!range_preset_pending) {
                $("#users_2month_range, #users_6month_range, #users_all_time_range").removeClass(
                    "selected",
                );
            }
            range_preset_pending = false;
            if (ranger === null) {
                return;
            }
            const {min, max} = _u.scales["x"]!;
            if (min !== undefined && max !== undefined) {
                ranger.set_range(min, max);
            }
        });

        // Double-click on the main chart resets to the full x range.
        uplot_instance.over.addEventListener("dblclick", () => {
            apply_preset_range($("#users_all_time_range"), null);
        });

        if (ranger === null) {
            ranger = make_ranger(
                ranger_container,
                uplot_data,
                data_min,
                data_max,
                CHART_WIDTH,
                [{stroke: series_stroke, fill: series_fill}],
                (range_min, range_max) => {
                    uplot_instance?.setScale("x", {min: range_min, max: range_max});
                },
            );
        } else {
            ranger.update_data(uplot_data);
        }
    }

    function set_plot_data(
        $button: JQuery,
        is_bar: boolean,
        series_label: string,
        uplot_data: UPlot.AlignedData,
    ): void {
        range_preset_pending = true;
        draw_plot(is_bar, series_label, uplot_data);
        select_data_set_button($button);
        select_preset_range_button($("#users_all_time_range"));
    }

    const daily_label = $t({defaultMessage: "Daily actives"});
    const fifteen_day_label = $t({defaultMessage: "15 day actives"});
    const total_label = $t({defaultMessage: "Total users"});

    $("#users_2month_range").on("click", function () {
        apply_preset_range($(this), {months: 2});
    });

    $("#users_6month_range").on("click", function () {
        apply_preset_range($(this), {months: 6});
    });

    $("#users_all_time_range").on("click", function () {
        apply_preset_range($(this), null);
    });

    $("#daily_active_users").on("click", function () {
        set_plot_data($(this), true, daily_label, _1day_data);
    });

    $("#15day_active_users").on("click", function () {
        set_plot_data($(this), false, fifteen_day_label, _15day_data);
    });

    $("#all_time_active_users").on("click", function () {
        set_plot_data($(this), false, total_label, all_time_data);
    });

    set_plot_data($("#all_time_active_users"), false, total_label, all_time_data);
    get_user_summary_statistics(data.everyone);
}

function populate_messages_read_over_time(raw_data: unknown): void {
    // Content rendered by this method is titled as "Messages read over time" on the webpage
    const result = read_data_schema.safeParse(raw_data);
    const data = handle_parse_server_stats_result(result);
    if (data === undefined) {
        return;
    }

    if (data.end_times.length === 0) {
        // TODO: do something nicer here
        return;
    }

    const start_dates = data.end_times.map(
        // data.end_times are the ends of hour long intervals.
        (timestamp) => new Date(timestamp * 1000 - 60 * 60 * 1000),
    );

    function aggregate_data(
        data: ReadData,
        aggregation: "day" | "week",
    ): AggregatedData<DataByEveryoneMe<number[]>> {
        let start;
        let is_boundary;
        if (aggregation === "day") {
            start = floor_to_local_day(start_dates[0]!);
            is_boundary = (date: Date) => date.getHours() === 0;
        } else {
            assert(aggregation === "week");
            start = floor_to_local_week(start_dates[0]!);
            is_boundary = (date: Date) => date.getHours() === 0 && date.getDay() === 0;
        }
        const dates = [start];
        const values: DataByEveryoneMe<number[]> = {everyone: [], me: []};
        let current: DataByEveryoneMe<number> = {everyone: 0, me: 0};
        let i_init = 0;
        if (is_boundary(start_dates[0]!)) {
            current = {everyone: data.everyone.read[0]!, me: data.user.read[0]!};
            i_init = 1;
        }
        for (let i = i_init; i < start_dates.length; i += 1) {
            if (is_boundary(start_dates[i]!)) {
                dates.push(start_dates[i]!);
                values.everyone.push(current.everyone);
                values.me.push(current.me);
                current = {everyone: 0, me: 0};
            }
            current.everyone += data.everyone.read[i]!;
            current.me += data.user.read[i]!;
        }
        values.everyone.push(current.everyone);
        values.me.push(current.me);
        return {
            dates,
            values,
            last_value_is_partial: !is_boundary(
                new Date(start_dates.at(-1)!.getTime() + 60 * 60 * 1000),
            ),
        };
    }

    type ReadView = {
        kind: "bar" | "line";
        xs: Float64Array;
        me: Float64Array;
        everyone: Float64Array;
        last_value_is_partial: boolean;
        format_date: (date: Date) => string;
    };

    function dates_to_xs(dates: Date[]): Float64Array {
        return new Float64Array(dates.map((d) => d.getTime() / 1000));
    }

    const daily_info = aggregate_data(data, "day");
    const daily_view: ReadView = {
        kind: "bar",
        xs: dates_to_xs(daily_info.dates),
        me: new Float64Array(daily_info.values.me),
        everyone: new Float64Array(daily_info.values.everyone),
        last_value_is_partial: daily_info.last_value_is_partial,
        format_date: (date) => format_date(date, false),
    };

    const weekly_info = aggregate_data(data, "week");
    const weekly_view: ReadView = {
        kind: "bar",
        xs: dates_to_xs(weekly_info.dates),
        me: new Float64Array(weekly_info.values.me),
        everyone: new Float64Array(weekly_info.values.everyone),
        last_value_is_partial: weekly_info.last_value_is_partial,
        format_date: (date) =>
            $t({defaultMessage: "Week of {date}"}, {date: format_date(date, false)}),
    };

    const cumulative_dates = data.end_times.map((t) => new Date(t * 1000));
    const cumulative_view: ReadView = {
        kind: "line",
        xs: dates_to_xs(cumulative_dates),
        me: new Float64Array(partial_sums(data.user.read)),
        everyone: new Float64Array(partial_sums(data.everyone.read)),
        last_value_is_partial: false,
        format_date: (date) => format_date(date, true),
    };

    const me_color = "rgb(190, 109, 104)";
    const everyone_color = "rgb(95, 110, 160)";
    const me_fill = "rgba(190, 109, 104, 0.7)";
    const everyone_fill = "rgba(95, 110, 160, 0.7)";

    const container = document.querySelector<HTMLElement>("#id_messages_read_over_time")!;
    const ranger_container = document.querySelector<HTMLElement>("#id_messages_read_ranger")!;

    const ALL_PRESET_BUTTONS =
        "#read_10day_range, #read_30day_range, #read_daily_all_time_range, " +
        "#read_2month_range, #read_6month_range, #read_weekly_all_time_range";

    const BAR_FACTOR = 0.7;

    let uplot_instance: UPlot | null = null;
    let ranger: Ranger | null = null;
    let range_preset_pending = false;
    // Series visibility persists across aggregation changes.  Initial:
    // Everyone shown, Me hidden (matches the original Plotly chart).
    const series_show: {me: boolean; everyone: boolean} = {me: false, everyone: true};
    let current_view: ReadView = daily_view;

    function preset_data_min(view: ReadView): number {
        return view.xs[0] ?? 0;
    }
    function preset_data_max(view: ReadView): number {
        return view.xs.at(-1) ?? 0;
    }

    function deselect_preset_buttons(): void {
        $(ALL_PRESET_BUTTONS).removeClass("selected");
    }

    function default_all_time_button(view: ReadView): JQuery {
        return view === weekly_view
            ? $("#read_weekly_all_time_range")
            : $("#read_daily_all_time_range");
    }

    function show_preset_row_for(view: ReadView): void {
        if (view === weekly_view) {
            $("#read_daily_range_presets").hide();
            $("#read_weekly_range_presets").show();
        } else {
            $("#read_daily_range_presets").show();
            $("#read_weekly_range_presets").hide();
        }
    }

    function make_opts(view: ReadView): UPlot.Options {
        const is_bar = view.kind === "bar";
        return {
            width: CHART_WIDTH,
            height: 400,
            scales: {
                x: {time: true},
                y: {range: (_u, _min, max) => [0, max !== null && max > 0 ? max : 1]},
            },
            axes: [
                {},
                {
                    // uPlot's default y-axis size of 50px clips labels for the
                    // cumulative view, where values reach the hundred-thousands.
                    // values is null on the pre-tick call.
                    size(_u, values) {
                        if (values === null) {
                            return 50;
                        }
                        const max_chars = Math.max(0, ...values.map((v) => v.length));
                        return Math.max(50, max_chars * 7 + 12);
                    },
                },
            ],
            series: [
                {
                    label: $t({defaultMessage: "Date"}),
                    value: (_u, v) =>
                        Number.isFinite(v) ? view.format_date(new Date(v * 1000)) : "—",
                },
                {
                    label: $t({defaultMessage: "Me"}),
                    show: series_show.me,
                    stroke: me_color,
                    width: 2,
                    points: {show: false},
                    ...(is_bar
                        ? {fill: me_fill, paths: make_grouped_bars_paths(0, 2, BAR_FACTOR)}
                        : {}),
                },
                {
                    label: $t({defaultMessage: "Everyone"}),
                    show: series_show.everyone,
                    stroke: everyone_color,
                    width: 2,
                    points: {show: false},
                    ...(is_bar
                        ? {fill: everyone_fill, paths: make_grouped_bars_paths(1, 2, BAR_FACTOR)}
                        : {}),
                },
            ],
            cursor: {
                y: false,
                drag: {setScale: true, x: true, y: false},
            },
            ...(is_bar && view.last_value_is_partial
                ? {hooks: {drawSeries: [make_fade_last_bar_hook(2, BAR_FACTOR)]}}
                : {}),
        };
    }

    function apply_preset_range($button: JQuery, preset: XRangePreset): void {
        if (uplot_instance === null) {
            return;
        }
        range_preset_pending = true;
        apply_x_range_preset(
            uplot_instance,
            preset_data_min(current_view),
            preset_data_max(current_view),
            preset,
        );
        deselect_preset_buttons();
        $button.addClass("selected");
    }

    function draw_plot(view: ReadView): void {
        if (uplot_instance === null) {
            // First draw: clear the loading spinner.
            $("#id_messages_read_over_time > div").removeClass("spinner");
        } else {
            // Persist series visibility across destroy/recreate so legend
            // toggles survive aggregation changes.
            series_show.me = uplot_instance.series[1]?.show ?? series_show.me;
            series_show.everyone = uplot_instance.series[2]?.show ?? series_show.everyone;
            uplot_instance.destroy();
        }
        current_view = view;
        const u_data: UPlot.AlignedData = [view.xs, view.me, view.everyone];
        uplot_instance = new UPlot(make_opts(view), u_data, container);

        // Sync ranger and deselect preset buttons whenever the x scale
        // changes (drag-to-zoom on the main chart or ranger drag).  The
        // hook fires asynchronously, so range_preset_pending guards
        // against a synchronous click handler that just selected a
        // button.
        (uplot_instance.hooks.setScale ??= []).push((_u, scaleKey) => {
            if (scaleKey !== "x") {
                return;
            }
            if (!range_preset_pending) {
                deselect_preset_buttons();
            }
            range_preset_pending = false;
            if (ranger === null) {
                return;
            }
            const {min, max} = _u.scales["x"]!;
            if (min !== undefined && max !== undefined) {
                ranger.set_range(min, max);
            }
        });

        // Double-click resets to the full x range.
        uplot_instance.over.addEventListener("dblclick", () => {
            apply_preset_range(default_all_time_button(current_view), null);
        });

        if (ranger === null) {
            ranger = make_ranger(
                ranger_container,
                u_data,
                preset_data_min(view),
                preset_data_max(view),
                CHART_WIDTH,
                [
                    {stroke: me_color, fill: me_fill},
                    {stroke: everyone_color, fill: everyone_fill},
                ],
                (range_min, range_max) => {
                    uplot_instance?.setScale("x", {min: range_min, max: range_max});
                },
            );
        } else {
            ranger.update_data(u_data);
        }
    }

    function set_view($button: JQuery, view: ReadView): void {
        $("#read_daily_button, #read_weekly_button, #read_cumulative_button").removeClass(
            "selected",
        );
        $button.addClass("selected");
        range_preset_pending = true;
        draw_plot(view);
        show_preset_row_for(view);
        deselect_preset_buttons();
        default_all_time_button(view).addClass("selected");
    }

    $("#read_daily_button").on("click", function () {
        set_view($(this), daily_view);
    });
    $("#read_weekly_button").on("click", function () {
        set_view($(this), weekly_view);
    });
    $("#read_cumulative_button").on("click", function () {
        set_view($(this), cumulative_view);
    });

    $("#read_10day_range").on("click", function () {
        apply_preset_range($(this), {days: 10});
    });
    $("#read_30day_range").on("click", function () {
        apply_preset_range($(this), {days: 30});
    });
    $("#read_daily_all_time_range").on("click", function () {
        apply_preset_range($(this), null);
    });
    $("#read_2month_range").on("click", function () {
        apply_preset_range($(this), {months: 2});
    });
    $("#read_6month_range").on("click", function () {
        apply_preset_range($(this), {months: 6});
    });
    $("#read_weekly_all_time_range").on("click", function () {
        apply_preset_range($(this), null);
    });

    if (weekly_view.xs.length < 12) {
        set_view($("#read_daily_button"), daily_view);
    } else {
        set_view($("#read_weekly_button"), weekly_view);
    }
}

// Above are helper functions that prepare the plot data
// Below are main functions that render the plots

function get_chart_data(
    data: {
        chart_name: string;
        min_length: string;
    },
    callback: (data: unknown) => void,
): void {
    void $.get({
        url: "/json/analytics/chart_data" + page_params.data_url_suffix,
        data,
        success(data) {
            callback(data);
            const {end_times} = z.object({end_times: z.array(z.number())}).parse(data);
            update_last_full_update(end_times);
        },
        error(xhr) {
            const parsed = z.object({msg: z.string()}).safeParse(xhr.responseJSON);
            if (parsed.success) {
                $("#id_stats_errors").show().text(parsed.data.msg);
            }
        },
    });
}

get_chart_data(
    {chart_name: "messages_sent_over_time", min_length: "10"},
    populate_messages_sent_over_time,
);

get_chart_data(
    {chart_name: "messages_sent_by_client", min_length: "10"},
    populate_messages_sent_by_client,
);

get_chart_data(
    {chart_name: "messages_sent_by_message_type", min_length: "10"},
    populate_messages_sent_by_message_type,
);

get_chart_data({chart_name: "number_of_humans", min_length: "10"}, populate_number_of_users);

get_chart_data(
    {chart_name: "messages_read_over_time", min_length: "10"},
    populate_messages_read_over_time,
);

set_storage_space_used_statistic(page_params.upload_space_used);
set_guest_users_statistic(page_params.guest_users);
