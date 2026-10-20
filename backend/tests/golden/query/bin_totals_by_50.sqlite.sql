SELECT CAST(CAST(q_orders.total / (50.0 + 0.0) AS INTEGER) - (q_orders.total / (50.0 + 0.0) < CAST(q_orders.total / (50.0 + 0.0) AS INTEGER)) AS FLOAT) * 50.0 AS total_bin, count(*) AS n 
FROM q_orders GROUP BY CAST(CAST(q_orders.total / (50.0 + 0.0) AS INTEGER) - (q_orders.total / (50.0 + 0.0) < CAST(q_orders.total / (50.0 + 0.0) AS INTEGER)) AS FLOAT) * 50.0 ORDER BY "total_bin" ASC
 LIMIT 2000 OFFSET 0
