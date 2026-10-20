SELECT CAST(date_trunc('quarter', q_orders.created_at) AS DATE) AS period, count(*) AS n 
FROM q_orders GROUP BY CAST(date_trunc('quarter', q_orders.created_at) AS DATE) ORDER BY "period" ASC 
 LIMIT 2000
