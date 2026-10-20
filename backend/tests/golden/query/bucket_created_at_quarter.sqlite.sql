SELECT date(q_orders.created_at, 'start of year', ('+' || CAST(((CAST(strftime('%m', q_orders.created_at) AS INTEGER) - 1) / 3) * 3 AS VARCHAR)) || ' months') AS period, count(*) AS n 
FROM q_orders GROUP BY date(q_orders.created_at, 'start of year', ('+' || CAST(((CAST(strftime('%m', q_orders.created_at) AS INTEGER) - 1) / 3) * 3 AS VARCHAR)) || ' months') ORDER BY "period" ASC
 LIMIT 2000 OFFSET 0
