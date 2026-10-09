import { AppError } from "@/lib/utils/errors";
import { throwIfDbError } from "@/lib/crm/action-utils";

type DbError = { code?: string; message: string } | null;

/** Turns the database's specific failure codes into sentences staff can act on. */
export function throwInvoicingError(error: DbError, context: string) {
  const fail = (m: string, c: string, s = 409): never => {
    throw new AppError(m, c, s);
  };
  switch (error?.code) {
    case "P0002":
      return fail("That record wasn't found.", "NOT_FOUND", 404);
    case "P0009":
      return fail("Please give a reason.", "REASON_REQUIRED", 400);
    case "P0011":
      return fail("This booking can't be invoiced in its current status.", "NOT_PAYABLE");
    case "P0013":
      return fail("This booking already has an open or issued invoice.", "CONFLICT");
    case "P0040":
      return fail("That GSTIN isn't valid. Check every character.", "BAD_GSTIN", 400);
    case "P0041":
      return fail("The GSTIN's state doesn't match the registered state.", "STATE_MISMATCH", 400);
    case "P0042":
      return fail("Save the invoicing profile first.", "NO_PROFILE");
    case "P0043":
      return fail(
        "Issued invoices can't be changed. Use a credit note to correct one.",
        "IMMUTABLE",
      );
    case "P0044":
      return fail("A discount is larger than its line amount.", "BAD_DISCOUNT", 400);
    case "P0045":
      return fail(
        "Complete the invoicing profile (legal name, address and state) before issuing.",
        "PROFILE_INCOMPLETE",
      );
    case "P0046":
      return fail("Add at least one line.", "NO_LINES", 400);
    case "P0047":
      return fail("Choose the place of supply.", "NO_PLACE", 400);
    case "P0048":
      return fail("Every line needs a tax code for a GST-registered agency.", "NO_TAX_CODE", 400);
    case "P0049":
      return fail(
        "A tax code on this invoice isn't verified or active. Verify it under Invoicing settings.",
        "UNVERIFIED_CODE",
      );
    case "P0050":
      return fail(
        "Tax can't be charged unless the agency is marked GST-registered.",
        "NOT_REGISTERED",
      );
    case "P0051":
      return fail(
        "That's more than was invoiced, or there's nothing left to credit.",
        "OVER_CREDIT",
      );
    case "22023":
      return fail("Some values are invalid. Please check the form.", "INVALID_VALUE", 400);
    case "23505":
      return fail("That already exists.", "DUPLICATE");
  }
  throwIfDbError(error, context);
}
