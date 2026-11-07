/** 固定向量钉住与 Go FNV-1a 32 位一致的匿名放量桶。 */
import { expect, it } from "vitest";
import { deviceCohort } from "../api/releases";
it.each([
  ["hello", 23],
  ["foobar", 20],
  ["", 61],
])("设备键 %s 的桶为 %i", (uid, bucket) => {
  expect(deviceCohort(uid as string)).toBe(bucket);
});
