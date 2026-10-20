SELECT CASE WHEN (q_orders.total >= 100) THEN 'big' ELSE 'small' END AS size, count(*) AS n 
FROM q_orders GROUP BY CASE WHEN (q_orders.total >= 100) THEN 'big' ELSE 'small' END ORDER BY "size" ASC
 LIMIT 2000 OFFSET 0
