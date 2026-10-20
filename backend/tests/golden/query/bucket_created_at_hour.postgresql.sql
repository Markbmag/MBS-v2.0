SELECT date_trunc('hour', q_orders.created_at) AS period, count(*) AS n 
FROM q_orders GROUP BY date_trunc('hour', q_orders.created_at) ORDER BY "period" ASC 
 LIMIT 2000
