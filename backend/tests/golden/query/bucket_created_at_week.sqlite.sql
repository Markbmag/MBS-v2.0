SELECT date(q_orders.created_at, '-6 days', 'weekday 1') AS period, count(*) AS n 
FROM q_orders GROUP BY date(q_orders.created_at, '-6 days', 'weekday 1') ORDER BY "period" ASC
 LIMIT 2000 OFFSET 0
