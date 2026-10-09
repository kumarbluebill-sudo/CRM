import { describe, expect, it } from "vitest";
import { gstinValid } from "@/lib/gst/gstin";
import { GST_STATES, stateCodeFromName, stateName } from "@/lib/gst/states";
import { amountInWords, numberToWordsIndian } from "@/lib/gst/words";

describe("GSTIN", () => {
  it("accepts valid ones and rejects altered ones", () => {
    expect(gstinValid("27AAPFU0939F1ZV")).toBe(true);
    expect(gstinValid("29AAGCB7383J1Z4")).toBe(true);
    expect(gstinValid("27AAPFU0939F1ZW")).toBe(false);
    expect(gstinValid("27aapfu0939f1zv")).toBe(false);
    expect(gstinValid("")).toBe(false);
    expect(gstinValid(null)).toBe(false);
    expect(gstinValid("00AAPFU0939F1ZV")).toBe(false);
  });
});

describe("states", () => {
  it("has unique codes and maps names, including common aliases", () => {
    expect(new Set(GST_STATES.map((s) => s.code)).size).toBe(GST_STATES.length);
    expect(stateName("27")).toBe("Maharashtra");
    expect(stateCodeFromName("Maharashtra")).toBe("27");
    expect(stateCodeFromName(" tamil  nadu ")).toBe("33");
    expect(stateCodeFromName("Jammu & Kashmir")).toBe("01");
    expect(stateCodeFromName("Orissa")).toBe("21");
    expect(stateCodeFromName("Atlantis")).toBeNull();
    expect(stateCodeFromName(null)).toBeNull();
  });
});

describe("amount in words", () => {
  it.each([
    [0, "Zero"],
    [7, "Seven"],
    [19, "Nineteen"],
    [21, "Twenty One"],
    [100, "One Hundred"],
    [1001, "One Thousand One"],
    [12980, "Twelve Thousand Nine Hundred Eighty"],
    [100000, "One Lakh"],
    [1234567, "Twelve Lakh Thirty Four Thousand Five Hundred Sixty Seven"],
    [10000000, "One Crore"],
    [123456789, "Twelve Crore Thirty Four Lakh Fifty Six Thousand Seven Hundred Eighty Nine"],
  ])("%i", (n, words) => expect(numberToWordsIndian(n)).toBe(words));

  it("formats rupees and paise, and rejects nonsense", () => {
    expect(amountInWords(12980)).toBe("Rupees Twelve Thousand Nine Hundred Eighty Only");
    expect(amountInWords(105.5)).toBe("Rupees One Hundred Five and Fifty Paise Only");
    expect(amountInWords(5, "USD")).toBe("USD Five Only");
    expect(() => numberToWordsIndian(-1)).toThrow();
    expect(() => numberToWordsIndian(1.5)).toThrow();
  });
});
