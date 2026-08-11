import { afterEach, describe, expect, it } from "vitest";
import {
	getApiProject,
	isInternalDomain,
	isInternalProject,
	isInternalScopeVisible,
	projectLabel,
	setApiProjectScope,
	sortProjects,
	type OperatorProject,
} from "./project-scope";
import { cn, formatMs, formatScore, formatTime, truncate } from "./utils";

afterEach(() => setApiProjectScope("", false));

describe("display utilities", () => {
	it("formats absent, short, and second-scale values", () => {
		expect(formatMs(null)).toBe("—");
		expect(formatMs(0.25)).toBe("<1ms");
		expect(formatMs(125)).toBe("125ms");
		expect(formatMs(1250)).toBe("1.25s");
		expect(formatScore(undefined)).toBe("—");
		expect(formatScore(0.12345)).toBe("0.123");
	});

	it("combines classes and truncates only when needed", () => {
		expect(cn("px-2", undefined, "px-4")).toBe("px-4");
		expect(truncate("short", 10)).toBe("short");
		expect(truncate("longer", 4)).toBe("long…");
		expect(formatTime(null)).toBe("—");
		expect(formatTime("2026-08-12T00:00:00.000Z")).not.toBe("—");
	});
});

describe("project scope", () => {
	const project = (
		overrides: Partial<OperatorProject> = {},
	): OperatorProject => ({
		name: "tenant-a",
		project: "tenant-a",
		description: "Research papers",
		kind_count: 2,
		file_count: 4,
		created_at: "2026-01-01T00:00:00Z",
		updated_at: "2026-01-01T00:00:00Z",
		...overrides,
	});

	it("tracks the selected project and internal visibility", () => {
		setApiProjectScope("tenant-a", true);
		expect(getApiProject()).toBe("tenant-a");
		expect(isInternalScopeVisible()).toBe(true);
		expect(isInternalDomain("legal")).toBe(false);
	});

	it("classifies internal project and domain conventions", () => {
		setApiProjectScope("default", false);
		expect(isInternalProject(project({ name: "proof-s" }))).toBe(true);
		expect(
			isInternalProject(
				project({ name: "customer", file_count: 0, kind_count: 0 }),
			),
		).toBe(true);
		expect(isInternalProject(project())).toBe(false);
		expect(isInternalDomain("legal")).toBe(true);
		expect(isInternalDomain("smoke-example")).toBe(true);
		expect(isInternalDomain("customer-docs")).toBe(false);
	});

	it("labels and sorts customer projects", () => {
		expect(projectLabel("tenant-a")).toBe("Research Papers");
		expect(projectLabel("custom_project")).toBe("Custom Project");
		expect(
			sortProjects([
				project({ name: "b", file_count: 1, kind_count: 3 }),
				project({ name: "a", file_count: 1, kind_count: 3 }),
				project({ name: "c", file_count: 2, kind_count: 1 }),
			]).map((item) => item.name),
		).toEqual(["c", "a", "b"]);
	});
});
