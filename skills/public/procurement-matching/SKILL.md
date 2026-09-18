---
name: procurement-matching
description: Use this skill for construction-material procurement matching, supplier sourcing, evidence verification, and procurement decision reports. Trigger when users upload BOQ/BOM/procurement lists or ask for supplier matching, qualification checks, price/delivery comparison, or procurement recommendations.
---

# Procurement Matching Skill

## Goal

Turn a procurement demand into a structured sourcing case for building-material and fire-protection procurement.

Always follow the MVP workflow:

1. Demand intake
2. Demand standardization
3. Sourcing match
4. Evidence verification
5. Procurement decision

## Required Tool Workflow

- Call `procurement_parse_requirements` first when the user uploads or describes a bill of quantities, BOM, spreadsheet, procurement list, or PDF/Word/Excel document.
- Use `procurement_save_state` after each major stage so the procurement workspace can render the latest status.
- Use `web_search` and `web_fetch` for public supplier discovery and evidence. Every verified claim must have a source URL.
- Use `procurement_render_report` when the user asks for a final recommendation, export, or report.

## Intake Rules

Extract only high-confidence demand fields:

- Material name
- Specification/model
- Quantity
- Unit
- Brand or equivalent-product requirement
- Notes

Ask the minimum missing questions before final decisions:

- Delivery address or project location
- Required delivery date/latest arrival time
- Budget cap or acceptable price range
- Brand, authorization, or equivalent-product constraint

## Standardization Rules

Normalize:

- Synonyms and abbreviations
- Specification/model variants
- Measurement units
- Brand and equivalent-product constraints

If a model/specification looks ambiguous, mark that item as `needs_confirmation`.

## Sourcing Rules

For each requirement, find candidate suppliers using public sources. Prefer:

- Supplier official websites
- Brand/manufacturer pages
- Public tender/procurement pages
- Industry platforms with visible product or supplier details

Candidate scoring should be conservative:

- Material match: 40%
- Supplier/product evidence: 25%
- Region and delivery fit: 15%
- Price signal: 10%
- Risk deduction: 10%

Do not give a high score to candidates without public evidence.

## Evidence Rules

Evidence should cover as many of these as possible:

- Business identity or operating status
- Product category or matching product page
- Qualification certificate or authorization
- Relevant case/project
- Price, inventory, or delivery signal

If public evidence is missing, expired, or indirect, set the candidate or evidence status to `pending_manual_confirmation`.

## Decision Rules

The decision output must include:

- Recommended supplier and reason
- Alternative supplier if available
- Price range and delivery estimate
- Evidence list with URLs
- Risks and manual confirmation items

Never claim that a supplier is qualified, authorized, in stock, or price-confirmed unless a public source supports it. For MVP, do not proceed into order placement, contract, payment, approval, or fulfillment workflows.
