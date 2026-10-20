SELECT CAST(date_trunc('month', q_orders.paid_on) AS DATE) AS period, count(*) AS n 
FROM q_orders GROUP BY CAST(date_trunc('month', q_orders.paid_on) AS DATE) ORDER BY "period" ASC 
 LIMIT 2000
