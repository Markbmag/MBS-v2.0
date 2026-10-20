SELECT date(q_orders.paid_on, 'start of month') AS period, count(*) AS n 
FROM q_orders GROUP BY date(q_orders.paid_on, 'start of month') ORDER BY "period" ASC
 LIMIT 2000 OFFSET 0
