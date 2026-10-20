SELECT TOP 2000 CAST(dateadd(week, datediff(week, 0, dateadd(day, -1, q_orders.created_at)), 0) AS DATE) AS period, count(*) AS n 
FROM q_orders GROUP BY CAST(dateadd(week, datediff(week, 0, dateadd(day, -1, q_orders.created_at)), 0) AS DATE) ORDER BY [period] ASC
