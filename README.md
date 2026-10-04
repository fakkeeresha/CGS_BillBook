# CGS Global Enterprises Bill Book

A small billing app with a vanilla HTML, CSS, and JavaScript frontend. Bills and line items are stored in `data/bills.xlsx`, created automatically when the server starts for the first time.

## Start the application on Windows

Double-click the **CGS Bill Book** shortcut on the Windows desktop to start the app and open it in your browser. The shortcut uses `start-app.bat` in the application folder. On launch, the script checks both the bill book and PDF extractor dependencies and installs or repairs any missing packages automatically. This also works after cloning the repository, provided Node.js and npm are installed. If the current backend is already running, the shortcut reuses it rather than starting another server. If an older server is using port 3000, close its server window and run the shortcut again to load the updated vendor balances and payment API. Keep the server window open while using the app. To stop the app, press **Ctrl+C** in that window.

If the desktop shortcut is missing, double-click `start-app.bat` in the application folder instead.

You can also start it from a terminal opened in the application folder:

```sh
npm install
npm install --prefix backend_dataserve
npm start
```

Then open [http://localhost:3000](http://localhost:3000). Node.js 18 or newer is recommended.

## Use the application

1. On the New Bill page, review the total, paid, and unpaid amount summary, then enter the seller, ship-to, invoice date, vehicle, and payment details.
2. To import a vendor invoice, choose a text-based PDF and select **Extract bill details**. Review the populated fields and line items; correct anything the PDF reader missed. Scanned/image-only PDFs are not supported without OCR.
3. Add or edit line items. Enter **Percentage of increase** to increase each item's excluding-GST rate, including-GST rate, and amount by that percentage. For example, a 10% increase changes a rate of ₹100.00 to ₹110.00. Line amounts use the excluding-GST rate; the bill total adds GST to the taxable amount after deducting any scheme/free item rows marked as **Discount**, then rounds the payable total up to the next whole rupee.
4. Review the calculated total and select **Save Bill**. Saved bills are recorded in `data/bills.xlsx` and `data/bills.json`.
5. Open **Explore Bills** to filter vendors by Ship To name, see their total/paid/unpaid balances, and record a received payment with its date. Payments are tracked against the vendor's combined balance, not assigned to individual bills; the remaining balance updates immediately and overpayments are rejected.
6. Open **History** to find saved bills, update legacy full-bill payment status, view an invoice, or download its PDF.

Keep the server window open while working, and close `data/bills.xlsx` in Excel before saving bills or changing payment status.

## Vendor PDF extraction

Install the local PDF analyzer dependencies once:

```sh
npm install --prefix backend_dataserve
```

Starting the bill book with `npm start` also starts the local PDF analyzer on port 3001. It requires no ChatGPT account, sign-in, or external API. Upload a text-based invoice PDF and click **Extract bill details**; the app analyzes its text and common invoice labels/table patterns, fills fields it recognizes, and saves the original extracted text plus the draft to separate JSON files. Check the populated fields and complete anything the analyzer missed before submitting. Scanned/image-only PDFs are not supported without OCR.

Run the isolated API, workbook, due-date, and PDF integration test with `npm test`. Test data is written to a temporary directory and does not change `data/bills.xlsx` or `data/bills.json`. Local invoice PDFs are excluded from the repository; tests that require those optional PDF samples are skipped when the files are absent.

In Bill History, open a record to view its invoice. **Download PDF** creates a downloadable A4 invoice PDF from that bill's `data/bills.json` record. New invoices default to 10 due days; the calculated due date is stored with the JSON bill.

## Sample bills for testing

Create these from **New Bill** to check both payment states and the history filters. Use the same seller for both: **CGS Global Enterprises**, 17 Residency Road, Bengaluru, Karnataka 560025; vehicle **KA02AF7135**. Add one item with description **Industrial packing boxes**, HSN **481910**, quantity **10**, unit **Bx**, rate excluding tax **125.00**, rate including tax **147.50**, and amount **1250.00**.

| Ship-to name | Ship-to address | Invoice date | Total amount | Payment status |
| --- | --- | --- | ---: | --- |
| Meridian Components | 42 Peenya Industrial Area, Bengaluru, Karnataka 560058 | 2026-10-01 | 1250.00 | Paid |
| Southern Works Depot | 8 Hosur Main Road, Bengaluru, Karnataka 560068 | 2026-10-02 | 1250.00 | Unpaid |

## Workbook layout

The workbook contains a consolidated `Bills` sheet, one `Bills YYYY-MM` sheet per invoice month, an `Items` sheet, and a `Payments` sheet. The Seller Name field is intentionally omitted from Excel; bill JSON retains the seller details for invoice generation. Bill IDs are assigned sequentially in the format `CGS-0001`. Submitted bills and their line items are saved in `data/bills.json`; dated vendor-level payment transactions are saved in `data/payments.json`. Existing bills marked `Paid` continue to count as paid, and new bills default to `Unpaid`. The percentage is applied once to each entered rate and line amount; the invoice total is the taxable amount after discounts plus the calculated GST.
