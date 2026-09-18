/**
 * How many items one request body may carry.
 *
 * Every line array in the API had `@ArrayMinSize(1)` and no ceiling, so a
 * single request could ask the server to price fifty thousand lines inside one
 * transaction — each one a catalog lookup and a FEFO pick — and hold a database
 * connection for as long as that took. No authentication is bypassed by it, and
 * nothing is corrupted; it is simply the cheapest way for one authenticated
 * client to make the shop's own tills time out.
 *
 * The numbers are set well above what the business actually does, so they never
 * come up in real use. They are a ceiling, not a policy: a counter sale has a
 * handful of lines, the longest route delivery a few dozen.
 */

/** Lines on one invoice, delivery, return or payment. */
export const MAX_LINES_PER_REQUEST = 500;

/**
 * Lines on one stocktake submission. Higher because a full count of a shop is
 * genuinely long, and it is posted in one go.
 */
export const MAX_COUNT_LINES_PER_REQUEST = 2000;

/** Units, prices or barcodes attached to one product. */
export const MAX_PRODUCT_CHILDREN = 50;
