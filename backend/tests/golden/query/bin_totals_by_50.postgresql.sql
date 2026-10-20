SELECT floor(q_orders.total / CAST(50.0 AS NUMERIC)) * 50.0 AS total_bin, count(*) AS n 
FROM q_orders GROUP BY floor(q_orders.total / CAST(50.0 AS NUMERIC)) * 50.0 ORDER BY "total_bin" ASC 
 LIMIT 2000
