# JR Retail OS — User Manual

A guide for shop owners and counter staff. **No technical knowledge needed.**

---

## Contents

1. [Starting your day](#1-starting-your-day)
2. [Making a bill](#2-making-a-bill)
3. [Keyboard shortcuts](#3-keyboard-shortcuts)
4. [When a customer returns something](#4-when-a-customer-returns-something)
5. [Taking money in advance](#5-taking-money-in-advance)
6. [Customers](#6-customers)
7. [Reward points](#7-reward-points)
8. [Products and stock](#8-products-and-stock)
9. [Special prices for wholesale customers](#9-special-prices-for-wholesale-customers)
10. [Buying stock from suppliers](#10-buying-stock-from-suppliers)
11. [Closing your day](#11-closing-your-day)
12. [Reports](#12-reports)
13. [When the internet stops working](#13-when-the-internet-stops-working)
14. [Deleting things safely](#14-deleting-things-safely)
15. [Settings you should set once](#15-settings-you-should-set-once)
16. [Common problems](#16-common-problems)
17. [Counting your stock](#17-counting-your-stock)
18. [Exchanging an item](#18-exchanging-an-item)
19. [Finding a bill the customer has lost](#19-finding-a-bill-the-customer-has-lost)
20. [Holding a bill for later](#20-holding-a-bill-for-later)
21. [Reprinting a bill](#21-reprinting-a-bill)
22. [Closing the drawer accurately](#22-closing-the-drawer-accurately)

---

## 1. Starting your day

**Open the app and sign in** with your email and password.

Before you can bill anything, **open the day session**:

1. Go to **Day Sessions**
2. Click **Open session**
3. Choose your branch
4. Enter the **opening cash** — the money physically in the drawer right now
5. Click **Open**

> **Why this matters.** At the end of the day the app compares the cash it
> *expects* against the cash you *actually have*. If the opening amount is
> wrong, that comparison is wrong all day.

---

## 2. Making a bill

Press **F2** from anywhere, or click **New Bill**.

### Step 1 — Add items

**Scan the barcode.** The item is added straight away. Keep scanning for more.

No scanner or no barcode? Type the product name or code in the search box and
pick from the list.

### Step 2 — Adjust if needed

- **Change quantity** — click the number and type, or use **+ / −**
- **Give a discount** — enter a percentage on the line
- **Remove an item** — click the bin icon

### Step 3 — Choose the customer *(optional)*

Leave it as **Walk-in** for a cash customer.

Pick a customer when you need to:
- put the bill on credit (**required**)
- give them their special wholesale rate
- earn them reward points

Once you pick a customer, their **reward points** appear just below the box.

### Step 4 — Take payment

Press **F4** to jump straight to the amount box.

- **Cash** — type what they handed you; change is calculated
- **Card / UPI** — enter the amount and reference
- **Split payment** — add more than one payment line
- **Credit (udhaar)** — enter less than the total, or nothing at all. The rest
  becomes their outstanding balance. **A customer must be selected.**

> If the customer has a **credit limit**, the app checks their *total*
> outstanding across every unpaid bill — not just this one. It will stop you
> before the limit is crossed.

### Step 5 — Save and print

- **F7** — Save the bill
- **F10** — Save and print

The receipt shows your shop name, address, **GSTIN**, every item, the tax
breakdown, and your own closing message.

---

## 3. Keyboard shortcuts

Learn these five and you will bill far faster than with the mouse.

| Key | What it does |
|---|---|
| **F2** | New bill (from anywhere) |
| **F7** | Save the bill |
| **F10** | Save and print |
| **F4** | Jump to the amount received box |
| **F3** | Hold the bill — park it and serve the next customer |
| **Shift + F3** | Open held bills to bring one back |
| **F9** | Go to the sales list |
| **Shift + F5** | Record a return |
| **F11** | Calculator |

### About Hold Bill (F3)

A customer is still deciding, but there is a queue behind them.

Press **F3** to park their cart, serve everyone else, then press **Shift + F3**
to bring it back exactly as it was. Nothing is lost, and you can hold as many
bills as you need.

### About the calculator (F11)

Press **F11** for a calculator that floats over your work. Type numbers and
`+ − × ÷` directly, **Enter** for `=`, **Esc** to close.

> It is deliberately **not** connected to the bill. Nothing you type in it can
> change a price or a total — it is a scratch pad, exactly like the one on your
> desk.

---

## 4. When a customer returns something

Press **Shift + F5**, or open the bill and choose **Return**.

1. **Find the original bill** — scan the receipt or search the bill number
2. **Choose what is coming back** — click a row to select it, and set the
   quantity with **+ / −**. Everything coming back? Click **Return everything**
3. **Give the reason** — required, and it appears on the credit note
4. **Refund the money**, or leave it on the customer's account
5. **Save**

> **Are they swapping it for something else?** Use **Exchange** instead — see
> [section 18](#18-exchanging-an-item). Do not refund the money and then ring
> up a new bill: that puts cash out of the drawer and straight back in, and
> your day's cash will not match.

What happens automatically:

- A **credit note** is created (number starts `CRN-`)
- The stock goes **back into inventory**
- The customer's balance is adjusted
- Any **reward points** from that bill are removed in proportion — return one
  item out of four and they keep three quarters of the points

> You can only return what has not already been returned. Return two of three
> shirts today, and only one remains returnable tomorrow.

---

## 5. Taking money in advance

A customer pays now for goods collected later — a wedding order, say.

1. **Sales → New Advance**
2. Choose the **customer** (required — money held against nobody cannot be
   returned to them)
3. Enter the **amount** and how it was paid
4. Save

An advance receipt is created (number starts `ADV-`) and the money shows on
their account. Their balance goes negative, meaning **the shop owes them**.

---

## 6. Customers

**Customers → New customer.** Name is the only required field; phone is
strongly recommended, as it is how you will find them again.

### Credit limit

Set a limit and the app stops staff from putting more on credit than you allow.
It counts **every** unpaid bill, so nobody can slip past by splitting one large
credit sale into several small ones.

### Customer page

Open any customer to see their profile, current outstanding balance, reward
points and history, and a full timeline of their purchases.

---

## 7. Reward points

### Setting it up (owner, once)

**Loyalty** in the sidebar. Two numbers to set, and they are different things:

- **Points per rupee** — what customers earn. `0.01` means one point per ₹100
- **Rupees per point** — what a point is worth back. `0.25` means four points
  to the rupee

> The screen shows a worked example: *"On a ₹1,000 bill the customer earns 10
> points, worth ₹2.50 — a giveback of 0.25%."* Check that number is one you are
> happy to pay before saving. It is your money.

**Points expire** after the number of days you set. Leave it blank and they
never expire.

### Membership tiers (optional)

Create tiers like Silver or Gold, reached by lifetime spending. A tier can
multiply the points a customer earns.

Customers are **promoted automatically** and never demoted.

### Day to day

- Points are added automatically when a named customer buys something
- Their balance shows on the billing screen once you select them
- To redeem, open the customer and use **Redeem points**

> **Important:** redeeming records the points as spent and tells you the rupee
> value. It does **not** reduce the bill by itself — enter that amount as a
> discount when billing.

---

## 8. Products and stock

### Adding a product

**Products → New product.** Fill in name, unit, tax rate and HSN code, then add
at least one variant with its SKU, cost price, MRP and selling price.

### Size and colour together

Selling one shirt in 4 sizes and 3 colours means 12 variants. Do not type them
one by one:

1. Open the product → **Variants** → **Generate matrix**
2. Enter sizes: `S, M, L, XL`
3. Enter colours: `Red, Blue, Black`
4. All 12 are created at once, each with its own SKU

### Adjusting stock

**Inventory → Adjust stock.** Give a reason — it is permanently recorded.

Use this for opening balances, damage, or after a physical count.

### Combo offers (bundles)

Sell a saree and blouse together as one item at one price:

1. Create the combo as a product with its own price
2. Open it → **Bundle** → add the saree and the blouse as components

When you sell the combo, **the saree and blouse come out of stock** — the combo
itself is never stocked, because it is a way of selling rather than a thing on
a shelf.

---

## 9. Special prices for wholesale customers

**Price Lists** in the sidebar.

1. Create a list — for example *Wholesale*
2. Add products and their special rates
3. Assign it to the customers who get those rates

When you select that customer at billing, their rate appears automatically, with
the normal price struck through so you can see the difference.

Products not on the list simply use their normal price.

---

## 10. Buying stock from suppliers

1. **Purchases → New purchase order**
2. Choose the supplier and add items with quantities and costs
3. **Confirm** the order
4. When the goods arrive, click **Receive** — stock goes up only now

### Buying in cartons, selling in pieces

Set the product's **purchase unit** to `Carton` and **conversion** to `12`.

Enter `20` cartons on the purchase order, and **240 pieces** enter stock. The
app does the arithmetic, so nobody has to do it in their head at the receiving
bay.

---

## 11. Closing your day

1. **Day Sessions → Close session**
2. Count the cash physically in the drawer
3. Enter that number as the **closing cash**
4. The app shows what it expected, and the difference

Any difference is recorded, not hidden. A small one usually means a change
error; a large one is worth investigating the same day.

---

## 12. Reports

| Report | Answers |
|---|---|
| **Dashboard** | How is today going? Revenue, bills, average bill, profit |
| **Sales** | Every bill, searchable |
| **Outstanding dues** | Who owes money, and how much |
| **Inventory** | What is in stock, what is running low |
| **Inventory health** | What is not selling, what to reorder |
| **Expenses** | Money going out |
| **Audit log** | Who did what, and when |

On the dashboard, green means good and red means worse than the period before.
Some figures — like tax collected — are shown without colour, because going up
or down is neither good nor bad.

---

## 13. When the internet stops working

**Keep selling. The app is built for this.**

Every bill is saved on the till itself the moment you save it — before any
attempt to reach the internet. Nothing waits for the network.

You will see an **offline** indicator. Everything continues:

- Scanning and billing
- Printing receipts
- Holding and resuming bills
- Looking up products

When the internet returns, bills sync automatically in the background. Check
the **Sync status** screen to confirm.

### Questions people ask

**Will a bill be counted twice if it syncs after a failed attempt?**
No. Each bill carries a unique code and the server accepts it exactly once,
however many times the till retries.

**What if I close the app while offline?**
Everything is saved. Reopen it and your bills are still there, still waiting to
sync.

**What if the power cuts mid-sale?**
Anything saved is safe. A cart you had not saved is lost — save with **F7** if
you are interrupted.

**Do offline bills get today's date when they finally sync?**
No. They keep the date and time they actually happened, and stay attached to the
correct day's session, so your cash reconciliation stays right.

---

## 14. Deleting things safely

Deleting a product, customer, supplier, or cancelling a bill asks for **your
password**.

This is deliberate. It stops an unattended till from being used to delete
records while you are away from the counter.

Enter your password once and you will not be asked again for **five minutes**,
so a batch of tidying up does not mean typing it repeatedly. After that, or
after signing out, it asks again.

> Cancelling (voiding) a bill puts stock back and removes the money from the
> day's takings. It is the single most consequential thing anyone can do at the
> till, which is why it is protected the same way.

---

## 15. Settings you should set once

**Stores → edit your branch:**

- **Name, address, phone** — printed on every receipt
- **GSTIN** — printed on every receipt. **Required for a valid tax invoice**
- **Receipt message** — your own closing line, such as *"M.S. wishes you a
  happy Holi"*

Each branch is set separately, because the two branches have different GSTINs
and may want different wording.

---

## 16. Common problems

| Problem | What to do |
|---|---|
| **"Open a day session first"** | Day Sessions → Open session |
| **Scanner types into the wrong box** | Click the scan box once; it keeps focus while billing |
| **Product not found when scanning** | The barcode may not be saved. Search by name, then add the barcode to the product |
| **"Customer required"** | The bill is unpaid or part-paid. Credit needs a named customer |
| **"Credit limit exceeded"** | Their total unpaid across all bills is at the limit. Collect payment, or an owner can raise it |
| **Receipt has no shop name or GSTIN** | Set them in Stores (§15), then reopen the billing screen |
| **Bills stuck as pending** | Check the internet, then Sync status. They are safe on the till |
| **Wrong password when deleting** | Your own login password. Not the customer's, not a PIN |
| **Windows warns when installing** | Expected — the app is not certificate-signed yet. Choose *More info* → *Run anyway* |
| **Points not being earned** | A customer must be selected on the bill, and a program must be set up under Loyalty |

### If something looks wrong with a number

Stop and check before changing anything.

Open the **Audit log** — it records who did what and when. For reward points,
open the customer and look at **Recent activity**: every change shows the
balance it produced, so you can see exactly where a figure came from.

---

*Version 0.1.0 · For support, contact your RetailOS supplier.*

---

## 17. Counting your stock

**This is the first thing to do before you start using the system properly.**

Your stock figures all start at **zero**. The old system's quantities were not
brought across, because they could not be trusted. Until you count, nothing the
software says about stock means anything.

### Doing a count

**Sidebar → Stock count → New count**

1. **Name the sheet** — the date is filled in for you
2. **Say what you are counting** — "Sarees, ground floor". You can count one
   section at a time; **nothing you do not count is touched**
3. **Leave "Blind count" ticked** (see below)
4. **Start counting** — scan an item, type how many are on the shelf, press
   **Enter**. The cursor comes back for the next one
5. When the section is done, press **Post**

### Why the expected number is hidden

A blind count does not show you what the computer thinks is there. This is
deliberate. If you can see the number you are "supposed" to find, it is very
easy — especially at the end of a long day — to write it down instead of
counting. A sheet like that tells you nothing.

After you post, every figure is shown: what you counted, what the books said,
and the difference.

### Counting while the shop is open

You can. If you count a rack at 6pm and post the sheet at 9pm, the system
applies **the difference you found**, not the total you wrote. Anything sold in
between stays sold. If something moved between counting and posting, it says so
on the summary.

### Negative stock

**Sidebar → Inventory → filter "Negative"**

A negative figure means the books are wrong somewhere — something was sold that
the system did not know you had, or a delivery was never entered. It cannot be
true of a real shelf, so every item on that list needs looking at. The worst
ones are at the top.

---

## 18. Exchanging an item

Wrong size is the commonest reason a customer comes back. Do not refund and
re-bill — use **Exchange**.

**Open the bill → Return → switch to Exchange**

1. **Choose what is coming back** — same as a return
2. **Scan what they are taking instead**
3. The panel tells you one of three things:
   - **Even swap** — nothing changes hands
   - **Customer pays ₹___** — take the difference
   - **Shop owes ₹___** — choose how to give it back, or leave it as credit
     for them to use later
4. **Record exchange**

### What the customer gets

**Two documents**, and this is correct:

- a **credit note** for what they brought back
- an **invoice** for what they are taking

This is what GST requires. The credit pays for the new bill automatically, so
no cash moves unless there is a genuine difference.

---

## 19. Finding a bill the customer has lost

**Sidebar → Sales → the "Find a bill" box**

Type any of:

- their **phone number** — spaces and dashes do not matter
- the **bill number**
- their **name**

While you are searching, the date filter is switched off — you are looking for
a bill and you do not know when it was.

---

## 20. Holding a bill for later

A customer steps away mid-bill. Press **F3** to park the cart, and serve the
next person. **Shift + F3** shows everything parked.

**Any till in your branch can pick it up.** A bill parked at counter 1 can be
finished at counter 2.

> **If the internet is down** when you park a bill, it is saved on **that
> computer only** and the row says "this till only". The other counter cannot
> see it. Finish it at the same machine.

---

## 21. Reprinting a bill

Every copy after the first is stamped **DUPLICATE COPY**.

This is not the software being awkward. Two identical bills can each be
presented as the original — for a return, for a warranty claim, to your
accountant — and nothing tells them apart. The stamp is what makes the first
one the original.

---

## 22. Closing the drawer accurately

At **Close and reconcile**, press **Count by note** instead of typing a total.

Enter how many ₹500s, how many ₹100s, and so on. The total is worked out for
you, so it cannot be mistyped — and if the drawer is short, you will know
exactly which note is missing rather than just that the number is wrong.

The **Day book** (Sidebar → Day book) shows every movement of money for the
day and what the drawer should hold. Card and UPI sales are kept separate from
cash there, because they do not change what is in the drawer.
