# SES Agent Desktop public OAuth pages

This static Sites project contains the public product homepage, privacy policy,
and terms required for the SES Agent Desktop Google OAuth review. English is the
primary review language; Japanese and Simplified Chinese routes contain the
same material disclosures.

## Routes

- `/`, `/privacy`, `/terms`
- `/ja`, `/ja/privacy`, `/ja/terms`
- `/zh`, `/zh/privacy`, `/zh/terms`

## Publication gates

Do not publish these pages as the final legal version or submit Google OAuth
verification until all of the following are confirmed:

1. `gridscale` is replaced with the complete legal operator name if that is not
   already the registered name used in customer agreements.
2. The chosen hostname is under a domain the operator is authorized to use and
   can verify in Google Search Console.
3. The same final homepage and privacy-policy URLs are entered in Google Auth
   Platform and linked from one another.
4. Product behavior is rechecked against the Google-data disclosures whenever
   Gmail or optional cloud processing changes.

Current support contact: `app_user01@gridscale.com`.
